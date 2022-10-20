import amqplib from 'amqplib';
jest.mock('amqplib');

const mockChannel = {} as jest.Mocked<amqplib.Channel>;

mockChannel.assertExchange = jest.fn();
mockChannel.publish = jest.fn();
mockChannel.assertQueue = jest.fn();
mockChannel.bindQueue = jest.fn();
mockChannel.consume = jest.fn();
mockChannel.close = jest.fn();
mockChannel.ack = jest.fn();

let mockChannelListeners: Array<any> = [];
mockChannel.on = jest.fn();
mockChannel.on.mockImplementation(function (event: string, callback: Function) {
  mockChannelListeners.push({ event, callback });
  return this;
});

mockChannel.off = jest.fn();
mockChannel.off.mockImplementation(function (event: string, callback: Function) {
  mockChannelListeners = mockChannelListeners.filter((listener) => !(listener.event === event && listener.callback === callback));
  return this;
});

mockChannel.emit = jest.fn();
mockChannel.emit.mockImplementation(function (event: string, data: any) {
  mockChannelListeners
    .filter((listener) => listener.event === event)
    .forEach((listener) => listener.callback(data));
  return this;
});

let mockChannelConsumers: Array<any> = [];
mockChannel.consume.mockImplementation(function (queue: string, callback: Function) {
  mockChannelConsumers.push({ queue, callback });
  return this;
});

function triggerMockChannelConsumer(exchange: string, routingKey: string, queue: string, data: any, serialize = true) {
  mockChannelConsumers
    .filter((consumer) => consumer.queue === queue)
    .forEach((consumer) => {
      const message = {
        content: Buffer.from(serialize ? JSON.stringify(data) : data),
        fields: {
          exchange,
          routingKey,
        },
      } as jest.Mocked<amqplib.Message>;
      consumer.callback(message);
    });
}

function resetMockChannelConsumers() {
  mockChannelConsumers = [];
}

const mockConnection = {} as jest.Mocked<amqplib.Connection>;
mockConnection.createChannel = jest.fn();
mockConnection.on = jest.fn();

let mockConnectionListeners: Array<any> = [];
mockConnection.on.mockImplementation(function (event: string, callback: Function) {
  mockConnectionListeners.push({ event, callback });
  return this;
});

mockConnection.off = jest.fn();
mockConnection.off.mockImplementation(function (event: string, callback: Function) {
  mockConnectionListeners = mockConnectionListeners.filter((listener) => !(listener.event === event && listener.callback === callback));
  return this;
});

mockConnection.emit = jest.fn();
mockConnection.emit.mockImplementation(function (event: string, data: any) {
  mockConnectionListeners
    .filter((listener) => listener.event === event)
    .forEach((listener) => listener.callback(data));
  return this;
});

mockConnection.close = jest.fn();

function triggerMockConnectionListener(event: string, data: any) {
  mockConnectionListeners
    .filter((listener) => listener.event === event)
    .forEach((listener) => listener.callback(data));
}

function resetMockConnectionListeners() {
  mockConnectionListeners = [];
}

function resetMockChannelListeners() {
  mockChannelListeners = [];
}

function createMockQueue(name = 'mock-queue') {
  const mockQueue = {
    queue: name,
  } as jest.Mocked<amqplib.Replies.AssertQueue>;

  return mockQueue;
}

const mockAmqplib = amqplib as jest.Mocked<typeof amqplib>;

function simulateConnectionProblem() {
  const connectionCloseErr: any = new Error('Connection closed: 320 (CONNECTION-FORCED) with message "CONNECTION_FORCED - broker forced connection closure with reason \'shutdown\'"');
  connectionCloseErr.code = 320;

  mockConnection.emit('error', connectionCloseErr);
  mockConnection.emit('close');
}

function simulateChannelProblem() {
  const connectionCloseErr: any = new Error('Connection closed: 320 (CONNECTION-FORCED) with message "CONNECTION_FORCED - broker forced connection closure with reason \'shutdown\'"');
  connectionCloseErr.code = 320;

  mockChannel.emit('error', connectionCloseErr);
  mockChannel.emit('close');
}

function simulateMissingExchange(exchange: string) {
  const missingExchangeErr: any = new Error(`Channel closed by server: 404 (NOT-FOUND) with message "NOT_FOUND - no exchange '${exchange}' in vhost '/'"`);
  missingExchangeErr.code = 404;
  missingExchangeErr.classId = 60;
  missingExchangeErr.methodId = 40;

  mockChannel.publish.mockImplementationOnce(() => {
    throw missingExchangeErr;
  });
}

function resetMocks() {
  mockAmqplib.connect.mockReset();

  mockConnection.createChannel.mockReset();
  mockConnection.close.mockReset();

  mockChannel.assertExchange.mockReset();
  mockChannel.publish.mockReset();
  mockChannel.assertQueue.mockReset();
  mockChannel.bindQueue.mockReset();
  mockChannel.consume.mockClear();
  mockChannel.close.mockClear();
  mockChannel.ack.mockClear();

  resetMockConnectionListeners();
  resetMockChannelConsumers();
  resetMockChannelListeners();

  mockAmqplib.connect.mockResolvedValue(mockConnection);
  mockConnection.createChannel.mockResolvedValue(mockChannel);
  mockChannel.assertQueue.mockResolvedValue(createMockQueue());
}

export {
  mockAmqplib,
  mockChannel,
  mockConnection,
  triggerMockChannelConsumer,
  createMockQueue,
  triggerMockConnectionListener,
  resetMocks,
  simulateConnectionProblem,
  simulateChannelProblem,
  simulateMissingExchange,
};
