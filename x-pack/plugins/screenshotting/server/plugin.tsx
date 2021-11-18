/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { Container } from 'inversify';
import { defer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type {
  CoreSetup,
  CoreStart,
  Logger,
  Plugin,
  PluginInitializerContext,
} from 'src/core/server';
import type { ScreenshotModePluginSetup } from 'src/plugins/screenshot_mode/server';
import { BrowsersModule, HeadlessChromiumDriverFactory } from './browsers';
import { ConfigModule, ConfigType } from './config';
import { getScreenshots, ScreenshotOptions } from './screenshots';
import * as Services from './services';

interface SetupDeps {
  screenshotMode: ScreenshotModePluginSetup;
}

export interface ScreenshottingStart {
  diagnose: HeadlessChromiumDriverFactory['diagnose'];
  getScreenshots(options: ScreenshotOptions): ReturnType<typeof getScreenshots>;
}

export class ScreenshottingPlugin implements Plugin<void, ScreenshottingStart, SetupDeps> {
  private container = new Container({ skipBaseClassChecks: true });

  constructor(context: PluginInitializerContext<ConfigType>) {
    const logger = context.logger.get();

    this.container.load(ConfigModule());
    this.container.bind(Services.Config).toConstantValue(context.config.get());
    this.container.bind(Services.Logger).toConstantValue(logger).whenTargetIsDefault();
    this.container
      .bind(Services.Logger)
      .toDynamicValue(({ currentRequest }) =>
        logger.get(currentRequest.target.getNamedTag()?.value!)
      )
      .when(({ target }) => target.isNamed());
  }

  setup({}: CoreSetup, { screenshotMode }: SetupDeps) {
    this.container.bind(Services.ScreenshotMode).toConstantValue(screenshotMode);

    return {};
  }

  start({}: CoreStart): ScreenshottingStart {
    const scope = this.container.createChild();
    scope.load(BrowsersModule());

    return {
      diagnose: () =>
        defer(() => scope.getAsync(HeadlessChromiumDriverFactory)).pipe(
          switchMap((factory) => factory.diagnose())
        ),
      getScreenshots: (options) =>
        defer(() => scope.getAsync(HeadlessChromiumDriverFactory)).pipe(
          switchMap((factory) =>
            getScreenshots(factory, scope.getNamed<Logger>(Services.Logger, 'screenshot'), options)
          )
        ),
    };
  }

  stop() {}
}
