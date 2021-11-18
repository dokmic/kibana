/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ContainerModule } from 'inversify';
import { Page } from 'puppeteer';
import * as Services from '../services';
import {
  BinaryPathToken,
  HeadlessChromiumDriver,
  HeadlessChromiumDriverFactory,
  HeadlessChromiumDriverFactoryToken,
  PageToken,
} from './chromium';
import { install } from './install';

export function BrowsersModule() {
  return new ContainerModule((bind) => {
    bind(BinaryPathToken).toDynamicValue(({ container }) =>
      install(container.getNamed(Services.Logger, 'chromium'))
    );
    bind(HeadlessChromiumDriverFactory).toSelf().inSingletonScope();
    bind(HeadlessChromiumDriverFactoryToken).toFactory<HeadlessChromiumDriver, [Page]>(
      ({ container }) =>
        (page) => {
          const scope = container.createChild();
          scope.bind(PageToken).toConstantValue(page);
          scope.bind(HeadlessChromiumDriver).toSelf();

          return scope.get(HeadlessChromiumDriver);
        }
    );
  });
}
