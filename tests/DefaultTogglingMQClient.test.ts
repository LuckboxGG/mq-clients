import { MQClient } from '../src/MQClient';
import { DefaultTogglingMQClient } from '../src/toggling/DefaultTogglingMQClient';

const mockedMQClient = {
  connect: jest.fn(),
  publish: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
} as jest.Mocked<MQClient>;

const client = new DefaultTogglingMQClient({
  mqClient: mockedMQClient,
  enabled: true,
});

describe('TogglingMQClient', () => {
  it('should act as a proxy for the connect method', () => {
    client.connect();

    expect(mockedMQClient.connect).toHaveBeenCalled();
  });

  it('should call the publish method only when the publishing is enabled', () => {
    client.publish('nsp1', {});
    expect(mockedMQClient.publish).toHaveBeenCalledWith('nsp1', {});

    client.disablePublishing();
    client.publish('nsp1', {});
    mockedMQClient.publish.mockClear();
    expect(mockedMQClient.publish).not.toHaveBeenCalled();

    client.enablePublishing();
    client.publish('nsp1', {});
    expect(mockedMQClient.publish).toHaveBeenCalledWith('nsp1', {});
  });

  it('should act as a proxy for the subscribe method', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const callback = () => { };
    client.subscribe('nsp1', callback);

    expect(mockedMQClient.subscribe).toHaveBeenCalledWith('nsp1', callback);
  });

  it('should act as a proxy for the subscribe method', () => {
    client.unsubscribe();

    expect(mockedMQClient.unsubscribe).toHaveBeenCalled();
  });
});
