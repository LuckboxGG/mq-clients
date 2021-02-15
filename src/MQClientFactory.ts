/* eslint-disable no-dupe-class-members */

import { DefaultTogglingMQClient } from './toggling/DefaultTogglingMQClient';
import { RabbitMQClient } from './rabbitmq/RabbitMQClient';
import { MQClient } from './MQClient';
import { TogglingMQClient } from './TogglingMQClient';

type Config = {
  rabbitMQ: ConstructorParameters<typeof RabbitMQClient>[0];
}

type TogglingConfig = Config & {
  togglingEnabled: boolean;
}

export class MQClientFactory {
  create(config: Config): MQClient;
  create(config: TogglingConfig): TogglingMQClient;
  create(config: any): any {
    const client: MQClient = new RabbitMQClient(config.rabbitMQ);
    if (config.togglingEnabled !== undefined) {
      return new DefaultTogglingMQClient({
        enabled: config.togglingEnabled,
        mqClient: client,
      });
    }

    return client;
  }
}
