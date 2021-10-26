/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import path from 'path';
import { PageOrientation, PredefinedPageSize } from 'pdfmake/interfaces';
import { EvaluateFn, SerializableOrJSHandle } from 'puppeteer';
import type { Logger } from 'src/core/server';
import type { LayoutConfig, LayoutInstance, LayoutSelectorDictionary, Size } from '.';
import { LayoutTypes } from '.';
import { HeadlessChromiumDriver } from '../browsers';
import { DEFAULT_VIEWPORT } from '../browsers';
import { getDefaultLayoutSelectors } from '.';
import { Layout } from './layout';

export class PrintLayout extends Layout implements LayoutInstance {
  public readonly selectors: LayoutSelectorDictionary = {
    ...getDefaultLayoutSelectors(),
    screenshot: '[data-shared-item]', // override '[data-shared-items-container]'
  };
  public readonly groupCount = 2;
  private readonly viewport = DEFAULT_VIEWPORT;

  constructor(private readonly config: LayoutConfig) {
    super(LayoutTypes.PRINT);
  }

  public getCssOverridesPath() {
    return path.join(__dirname, 'print.css');
  }

  public getBrowserViewport() {
    return this.viewport;
  }

  public getBrowserZoom() {
    return this.config.zoom;
  }

  public getViewport(itemsCount: number) {
    return {
      zoom: this.config.zoom,
      width: this.viewport.width,
      height: this.viewport.height * itemsCount,
    };
  }

  public async positionElements(browser: HeadlessChromiumDriver, logger: Logger): Promise<void> {
    logger.debug('positioning elements');

    const elementSize: Size = {
      width: this.viewport.width / this.config.zoom,
      height: this.viewport.height / this.config.zoom,
    };
    const evalOptions: { fn: EvaluateFn; args: SerializableOrJSHandle[] } = {
      fn: (selector: string, height: number, width: number) => {
        const visualizations = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
        const visualizationsLength = visualizations.length;

        for (let i = 0; i < visualizationsLength; i++) {
          const visualization = visualizations[i];
          const style = visualization.style;
          style.position = 'fixed';
          style.top = `${height * i}px`;
          style.left = '0';
          style.width = `${width}px`;
          style.height = `${height}px`;
          style.zIndex = '1';
          style.backgroundColor = 'inherit';
        }
      },
      args: [this.selectors.screenshot, elementSize.height, elementSize.width],
    };

    await browser.evaluate(evalOptions, { context: 'PositionElements' }, logger);
  }

  public getPdfImageSize() {
    return {
      width: 500,
    };
  }

  public getPdfPageOrientation(): PageOrientation {
    return 'portrait';
  }

  public getPdfPageSize(): PredefinedPageSize {
    return 'A4';
  }
}
