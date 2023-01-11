import assert from 'assert';
import amqplib from 'amqplib';
import PQueue from 'p-queue';

import { CallbackFunc, DataPayload, MQClient } from '../MQClient';
import makeEnum from '../utils/makeEnum';
import { Adapters, Logger, LoggerFactory, SupportedLogLevels, Tag, tagString } from '@luckbox/logger-factory';

const ExchangeType = makeEnum({
  Fanout: 'fanout',
  Direct: 'direct',
});

type ExchangeType = (typeof ExchangeType)[keyof typeof ExchangeType];

interface ExchangeConfig {
  type: ExchangeType;
  name?: string;
  durable?: boolean;
}

interface QueueConfig {
  name: string;
  exclusive: boolean;
}

interface ConstructorParams {
  amqp?: amqplib.Options.Connect;
  exchange: ExchangeConfig;
  queue?: QueueConfig;
  retryTimeout?: number;
  debug?: boolean;
  logger?: Logger;
}

class RabbitMQClient implements MQClient {
  private readonly amqpConfig: amqplib.Options.Connect;
  private readonly retryTimeout: number;
  private readonly debug: boolean;
  private readonly exchangeConfig: ExchangeConfig;
  private readonly queueConfig: QueueConfig;
  private readonly logger: Logger;

  private connection: amqplib.Connection;
  private channel: amqplib.Channel;
  private hasBeenConnected: boolean;
  private subscriptions: Map<string, Array<CallbackFunc>>;
  private queue: PQueue;
  private setupConnectionPromise: Promise<void>;
  private hasManuallyUnsubscribed: boolean;
  private existingExchanges: Array<string>;

  constructor(params: ConstructorParams) {
    this.amqpConfig = params.amqp !== undefined ? params.amqp : {};
    this.retryTimeout = params.retryTimeout !== undefined ? params.retryTimeout : 1000;
    this.debug = params.debug !== undefined ? params.debug : true;
    this.logger = params.logger ?? new LoggerFactory({
      adapters: [
        {
          name: Adapters.Console,
          config: {
            skipTimestamps: false,
            logLevel: params.debug ? SupportedLogLevels.Error : SupportedLogLevels.System,
          },
        },
      ],
    }).create(this.constructor.name);

    if (params.exchange.type === ExchangeType.Direct) {
      assert(
        typeof params.exchange.name === 'string' &&
        params.exchange.name.length > 0,
        'Direct exchange requires a name',
      );
    }

    this.exchangeConfig = params.exchange;

    this.queueConfig = params.queue ?? {
      name: '',
      exclusive: true,
    };

    this.hasBeenConnected = false;
    this.subscriptions = new Map<string, Array<CallbackFunc>>();
    this.queue = new PQueue({ concurrency: 1 });
    this.setupConnectionPromise = null;
    this.hasManuallyUnsubscribed = false;
    this.existingExchanges = [];
  }

  async connect(): Promise<void> {
    await this.setupConnection();

    this.hasBeenConnected = true;
  }

  publish(namespace: string, data: DataPayload): void {
    assert(this.hasBeenConnected, 'You must connect() first!');

    this.publishSynchronously(namespace, data);
  }

  async subscribe(namespace: string, callback: CallbackFunc): Promise<void> {
    assert(this.connection, 'You must connect() first!');

    const subscriptionKey = this.isExchangeInDirectType()
      ? `${this.exchangeConfig.name}#${namespace}`
      : namespace;

    this.saveSubscription(subscriptionKey, callback);
    await this.createExchangeIfNecessary(namespace);
    await this.createQueueAndBindItToExchange(namespace);
  }

  async unsubscribe(): Promise<void> {
    assert(this.connection, 'You must connect() first!');
    assert(this.subscriptions.size, 'You must subscribe() first!');

    this.hasManuallyUnsubscribed = true;
    await this.channel.close();
    await this.connection.close();
  }

  private async setupConnection(): Promise<void> {
    if (this.setupConnectionPromise) {
      return this.setupConnectionPromise;
    }

    const setupConnectionLoop = async (): Promise<void> => {
      try {
        await this.createConnectionAndChannel();
        this.bindListeners();
        await this.recreateSubscriptions();
      } catch (err) {
        this.logger.error(err);
        await this.sleep(this.retryTimeout);
        return setupConnectionLoop();
      }
    };

    // eslint-disable-next-line no-async-promise-executor
    this.setupConnectionPromise = new Promise(async (resolve) => {
      await setupConnectionLoop();
      this.setupConnectionPromise = null;
      resolve();
    });

    return this.setupConnectionPromise;
  }

  private async createConnectionAndChannel() {
    this.connection = await amqplib.connect(this.amqpConfig);
    this.channel = await this.connection.createChannel();
  }

  private bindListeners() {
    this.connection.off('error', this.handleConnectionOrChannelProblem);
    this.connection.on('error', this.handleConnectionOrChannelProblem);
    this.connection.off('close', this.handleConnectionOrChannelProblem);
    this.connection.on('close', this.handleConnectionOrChannelProblem);

    this.channel.off('error', this.handleConnectionOrChannelProblem);
    this.channel.on('error', this.handleConnectionOrChannelProblem);
    this.channel.off('close', this.handleConnectionOrChannelProblem);
    this.channel.on('close', this.handleConnectionOrChannelProblem);
  }

  private handleConnectionOrChannelProblem = async (err?: Error) => {
    if (this.hasManuallyUnsubscribed) {
      return;
    }

    if (err) {
      this.logger.error(err);
    }

    await this.setupConnection();
  };

  private async recreateSubscriptions() {
    for (const [subscriptionKey] of this.subscriptions) {
      let namespace;
      if (this.isExchangeInDirectType()) {
        namespace = subscriptionKey.split('#', 2)[1];
      } else {
        namespace = subscriptionKey;
      }

      await this.createExchangeIfNecessary(namespace);
      await this.createQueueAndBindItToExchange(namespace);
    }
  }

  private async publishSynchronously(namespace: string, data: DataPayload) {
    const tryToSendMessageLoop = async (): Promise<void> => {
      try {
        await this.createExchangeIfNecessary(namespace);
        this.publishDataInExchange(data, namespace);

        return;
      } catch (err) {
        this.logger.error(err);
        await this.setupConnection();

        if (err.code === 404 && err.classId === 60 && err.methodId === 40) {
          this.existingExchanges.splice(this.existingExchanges.indexOf(namespace), 1);
        }
      }

      return tryToSendMessageLoop();
    };

    await this.queue.add(tryToSendMessageLoop);
  }

  private saveSubscription(key: string, callback: CallbackFunc) {
    const callbacks = this.subscriptions.has(key)
      ? this.subscriptions.get(key)
      : [];
    callbacks.push(callback);

    this.subscriptions.set(key, callbacks);
  }

  private async createExchangeIfNecessary(exchange: string) {
    const config = {
      durable: this.exchangeConfig.durable !== undefined ? this.exchangeConfig.durable : true,
    };

    let exchangeName: string;
    let exchangeType: ExchangeType;
    if (this.isExchangeInDirectType()) {
      exchangeName = this.exchangeConfig.name;
      exchangeType = ExchangeType.Direct;
    } else {
      exchangeName = exchange;
      exchangeType = ExchangeType.Fanout;
    }

    if (this.existingExchanges.includes(exchangeName)) {
      return;
    }

    await this.channel.assertExchange(exchangeName, exchangeType, config);
    this.existingExchanges.push(exchangeName);
  }

  private isExchangeInDirectType() {
    return this.exchangeConfig.type === ExchangeType.Direct;
  }

  private publishDataInExchange(data: any, namespace: string) {
    if (this.isExchangeInDirectType()) {
      this.channel.publish(this.exchangeConfig.name, namespace, this.toBuffer(data), {
        persistent: true,
      });
    } else {
      this.channel.publish(namespace, '', this.toBuffer(data), {
        persistent: true,
      });
    }
  }

  private sleep(msec: number) {
    return new Promise((resolve) => setTimeout(resolve, msec));
  }

  private async createQueueAndBindItToExchange(namespace: string) {
    const queue = await this.channel.assertQueue(this.queueConfig.name, { exclusive: this.queueConfig.exclusive });

    if (this.isExchangeInDirectType()) {
      await this.channel.bindQueue(queue.queue, this.exchangeConfig.name, namespace);
    } else {
      await this.channel.bindQueue(queue.queue, namespace, '');
    }

    await this.channel.consume(queue.queue, async (msg) => {
      let parsed;
      try {
        parsed = this.parseBuffer(msg.content);
      } catch (err) {
        this.logger.error(err);
        return;
      }

      const subscriptionKey = this.isExchangeInDirectType() ? `${msg.fields.exchange}#${msg.fields.routingKey}` : msg.fields.exchange;

      const callbacks = this.subscriptions.get(subscriptionKey);
      let hasThrown = false;

      if (callbacks && callbacks.length) {
        for (const callback of callbacks) {
          try {
            await callback(parsed);
          } catch (error) {
            this.logger.error(`A callback for namespace '${namespace}' has thrown an exception - ${tagString(error instanceof Error ? error.stack : error.toString(), Tag.PII)}`);
            hasThrown = true;
          }
        }
      }

      if (!hasThrown) {
        this.channel.ack(msg);
      }
    });
  }

  private toBuffer(data: unknown) {
    return Buffer.from(JSON.stringify(data));
  }

  private parseBuffer(buffer: Buffer) {
    return JSON.parse(buffer.toString());
  }
}

export {
  RabbitMQClient,
  // eslint-disable-next-line no-undef
  ConstructorParams as RabbitMQClientConstructorParams,
};
