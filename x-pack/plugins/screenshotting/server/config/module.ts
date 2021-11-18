/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ContainerModule } from 'inversify';
import * as Services from '../services';
import { createConfig } from './create_config';
import { ConfigType } from './schema';

export function ConfigModule() {
  return new ContainerModule((bind, unbind, isBoud, rebind, unbindAsync, onActivation) => {
    onActivation<ConfigType>(Services.Config, ({ container }, config) =>
      createConfig(container.getNamed(Services.Logger, 'config'), config)
    );
  });
}
