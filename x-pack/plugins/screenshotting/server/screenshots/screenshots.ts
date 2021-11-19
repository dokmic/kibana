/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { injectable, inject, interfaces, named } from 'inversify';
import apm from 'elastic-apm-node';
import { from, of, Observable } from 'rxjs';
import {
  catchError,
  concatMap,
  first,
  map,
  mergeMap,
  take,
  takeUntil,
  toArray,
} from 'rxjs/operators';
import type { Logger } from 'src/core/server';
import { LayoutParams } from '../../common';
import { HeadlessChromiumDriver, HeadlessChromiumDriverFactory } from '../browsers';
import { createLayout } from '../layouts';
import type { Layout } from '../layouts';
import * as Services from '../services';
import { ScreenshotObservableHandler } from './observable';
import type { ScreenshotObservableOptions, ScreenshotObservableResult } from './observable';

export interface ScreenshotOptions extends ScreenshotObservableOptions {
  layout: LayoutParams;
}

export interface ScreenshotResult {
  layout: Layout;
  results: ScreenshotObservableResult[];
}

export const ScreenshotObservableFactoryToken = Symbol.for('ScreenshotObservableFactory');

const DEFAULT_SETUP_RESULT = {
  elementsPositionAndAttributes: null,
  timeRange: null,
};

@injectable()
export class Screenshots {
  constructor(
    @inject(HeadlessChromiumDriverFactory)
    private driverFactory: HeadlessChromiumDriverFactory,
    @inject(Services.Logger) @named('screenshot') private logger: Logger,
    @inject(ScreenshotObservableFactoryToken)
    private screenshotObservableFactory: interfaces.SimpleFactory<
      ScreenshotObservableHandler,
      [HeadlessChromiumDriver, Layout, ScreenshotObservableOptions]
    >
  ) {}

  getScreenshots(options: ScreenshotOptions): Observable<ScreenshotResult> {
    const apmTrans = apm.startTransaction(`screenshot pipeline`, 'reporting');
    const apmCreateLayout = apmTrans?.startSpan('create_layout', 'setup');
    const layout = createLayout(options.layout);
    this.logger.debug(`Layout: width=${layout.width} height=${layout.height}`);
    apmCreateLayout?.end();

    const apmCreatePage = apmTrans?.startSpan('create_page', 'wait');
    const {
      browserTimezone,
      timeouts: { openUrl: openUrlTimeout },
    } = options;

    return this.driverFactory.createPage({ browserTimezone, openUrlTimeout }, this.logger).pipe(
      mergeMap(({ driver, exit$ }) => {
        apmCreatePage?.end();
        exit$.subscribe({ error: () => apmTrans?.end() });

        const screen = this.screenshotObservableFactory(driver, layout, options);

        return from(options.urls).pipe(
          concatMap((url, index) =>
            screen.setupPage(index, url, apmTrans).pipe(
              catchError((error) => {
                screen.checkPageIsOpen(); // this fails the job if the browser has closed

                this.logger.error(error);
                return of({ ...DEFAULT_SETUP_RESULT, error }); // allow failover screenshot capture
              }),
              takeUntil(exit$),
              screen.getScreenshots()
            )
          ),
          take(options.urls.length),
          toArray(),
          map((results) => ({ layout, results }))
        );
      }),
      first()
    );
  }
}
