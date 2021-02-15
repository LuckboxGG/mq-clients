import { MQClient } from './MQClient';

export interface TogglingMQClient extends MQClient {
  enablePublishing(): void;
  disablePublishing(): void;
}
