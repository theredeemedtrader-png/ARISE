import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { AriseCandle, ChartPoint } from './model';

export type ChartTheme = 'dark' | 'light';

export interface ChartClick {
  readonly time: number;
  readonly price: number;
  readonly candle: AriseCandle | null;
}

function numericTime(value: Time | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function asCandlestick(candle: AriseCandle): CandlestickData<UTCTimestamp> {
  return {
    time: candle.time as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

export class AriseChartController {
  private readonly chart: ReturnType<typeof createChart>;
  private readonly series: ISeriesApi<'Candlestick'>;
  private readonly resizeObserver: ResizeObserver;
  private candles: readonly AriseCandle[] = [];
  private clickHandler: ((click: ChartClick) => void) | null = null;

  private readonly handleClick = (param: MouseEventParams<Time>) => {
    if (!this.clickHandler || !param.point) return;
    const eventTime = numericTime(param.time);
    const coordinateTime = numericTime(this.chart.timeScale().coordinateToTime(param.point.x));
    const time = eventTime ?? coordinateTime;
    const price = this.series.coordinateToPrice(param.point.y);
    if (time === null || price === null || !Number.isFinite(price)) return;
    const candle = this.candles.find((entry) => entry.time === time) ?? null;
    this.clickHandler(Object.freeze({ time, price, candle }));
  };

  constructor(private readonly container: HTMLElement, theme: ChartTheme) {
    this.chart = createChart(container, this.options(theme));
    this.series = this.chart.addSeries(CandlestickSeries, {
      upColor: '#248bf0',
      downColor: '#f9262e',
      borderVisible: false,
      wickUpColor: '#5aa9f5',
      wickDownColor: '#ff6167',
      priceLineVisible: false,
    });
    this.chart.subscribeClick(this.handleClick);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  private options(theme: ChartTheme) {
    const dark = theme === 'dark';
    return {
      autoSize: false,
      attributionLogo: true,
      layout: {
        background: { type: ColorType.Solid, color: dark ? '#09121d' : '#f7f9fc' },
        textColor: dark ? '#7890a8' : '#536579',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: dark ? '#152638' : '#e4eaf1' },
        horzLines: { color: dark ? '#152638' : '#e4eaf1' },
      },
      crosshair: {
        vertLine: { color: dark ? '#526d87' : '#8a9bad', labelBackgroundColor: '#248bf0' },
        horzLine: { color: dark ? '#526d87' : '#8a9bad', labelBackgroundColor: '#248bf0' },
      },
      rightPriceScale: {
        borderColor: dark ? '#203247' : '#d7e0ea',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: dark ? '#203247' : '#d7e0ea',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 7,
      },
      handleScroll: true,
      handleScale: true,
    };
  }

  setTheme(theme: ChartTheme): void {
    this.chart.applyOptions(this.options(theme));
  }

  setPriceFormat(priceDigits: number, tickSize: number): void {
    this.series.applyOptions({ priceFormat: { type: 'price', precision: priceDigits, minMove: tickSize } });
  }

  setData(candles: readonly AriseCandle[]): void {
    this.candles = candles;
    this.series.setData(candles.map(asCandlestick));
  }

  update(candle: AriseCandle): void {
    this.series.update(asCandlestick(candle));
  }

  fitContent(): void {
    this.chart.timeScale().fitContent();
  }

  timeToX(time: number): number | null {
    return this.chart.timeScale().timeToCoordinate(time as UTCTimestamp);
  }

  width(): number {
    return this.container.getBoundingClientRect().width;
  }

  priceToY(price: number): number | null {
    return this.series.priceToCoordinate(price);
  }

  pointFromClient(clientX: number, clientY: number): ChartPoint | null {
    const rect = this.container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const time = numericTime(this.chart.timeScale().coordinateToTime(x));
    const price = this.series.coordinateToPrice(y);
    return time !== null && price !== null && Number.isFinite(price)
      ? Object.freeze({ time, price })
      : null;
  }

  onClick(handler: ((click: ChartClick) => void) | null): void {
    this.clickHandler = handler;
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.chart.resize(Math.floor(rect.width), Math.floor(rect.height));
    }
  }

  destroy(): void {
    this.chart.unsubscribeClick(this.handleClick);
    this.resizeObserver.disconnect();
    this.chart.remove();
  }
}
