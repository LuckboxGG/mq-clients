import {
  MQClient,
  DataPayload,
  CallbackFunc,
} from '../MQClient';

import { TogglingMQClient } from '../TogglingMQClient';

type ConstructorParams = {
  mqClient: MQClient;
  enabled: boolean;
};

export class DefaultTogglingMQClient implements TogglingMQClient {
  private readonly mqClient: MQClient;
  private enabled: boolean;

  constructor(params: ConstructorParams) {
    this.mqClient = params.mqClient;
    this.enabled = params.enabled;
  }

  connect(): Promise<void> {
    return this.mqClient.connect();
  }

  publish(namespace: string, data: DataPayload): void {
    if (!this.enabled) {
      return;
    }

    return this.mqClient.publish(namespace, data);
  }

  subscribe(namespace: string, callback: CallbackFunc): Promise<void> {
    return this.mqClient.subscribe(namespace, callback);
  }

  unsubscribe(): Promise<void> {
    return this.mqClient.unsubscribe();
  }

  enablePublishing() {
    this.enabled = true;
  }

  disablePublishing() {
    this.enabled = false;
  }
}
