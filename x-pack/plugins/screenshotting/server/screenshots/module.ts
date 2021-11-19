/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ContainerModule } from 'inversify';
import { HeadlessChromiumDriver } from '../browsers';
import type { Layout } from '../layouts';
import {
  LayoutToken,
  ScreenshotObservableHandler,
  ScreenshotObservableOptions,
  ScreenshotObservableOptionsToken,
} from './observable';
import { ScreenshotObservableFactoryToken, Screenshots } from '.';

export function ScreenshotsModule() {
  return new ContainerModule((bind) => {
    bind(ScreenshotObservableFactoryToken).toFactory<
      ScreenshotObservableHandler,
      [HeadlessChromiumDriver, Layout, ScreenshotObservableOptions]
    >(({ container }) => (driver, layout, options) => {
      const scope = container.createChild();
      scope.bind(HeadlessChromiumDriver).toConstantValue(driver);
      scope.bind(LayoutToken).toConstantValue(layout);
      scope.bind(ScreenshotObservableOptionsToken).toConstantValue(options);
      scope.bind(ScreenshotObservableHandler).toSelf();

      return scope.get(ScreenshotObservableHandler);
    });
    bind(Screenshots).toSelf().inSingletonScope();
  });
}
