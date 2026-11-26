import { useEffect, useRef } from 'react';
import { ColorType, createChart, CrosshairMode, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { SECTOR_LABEL, fmtPct, fmtPrice } from '@warmarket/shared';
import { useStore } from '../state/store';

export function PriceChart() {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vol = useRef<ISeriesApi<'Histogram'> | null>(null);
  const selected = useStore((s) => s.selectedAsset);
  const candles = useStore((s) => s.history[s.selectedAsset]);
  const quote = useStore((s) => s.quotes[s.selectedAsset]);
  const info = useStore((s) => s.static?.assets.find((a) => a.id === s.selectedAsset));
  const nation = useStore((s) => s.static?.nations.find((n) => n.id === info?.nationId));
  const lastLen = useRef(0);
  const lastAsset = useRef('');

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0f141a' }, textColor: '#7d8a99', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
      grid: { vertLines: { color: '#151c24' }, horzLines: { color: '#151c24' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1e2731' },
      timeScale: { borderColor: '#1e2731', timeVisible: true, secondsVisible: true, rightOffset: 3 },
    });
    series.current = c.addCandlestickSeries({
      upColor: '#2bd47d',
      downColor: '#ff4d5e',
      borderUpColor: '#2bd47d',
      borderDownColor: '#ff4d5e',
      wickUpColor: '#2bd47d',
      wickDownColor: '#ff4d5e',
      priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
    });
    vol.current = c.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, color: '#2a3644' });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (!series.current || !vol.current || !candles) return;
    const precision = candles.length && candles[candles.length - 1].close < 1 ? 4 : candles.length && candles[candles.length - 1].close < 100 ? 2 : 1;
    series.current.applyOptions({ priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision } });
    const data = candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));
    const vols = candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? 'rgba(43,212,125,0.35)' : 'rgba(255,77,94,0.35)' }));
    if (lastAsset.current !== selected || candles.length < lastLen.current || candles.length - lastLen.current > 1) {
      series.current.setData(data);
      vol.current.setData(vols);
      chart.current?.timeScale().fitContent();
    } else if (data.length) {
      series.current.update(data[data.length - 1]);
      vol.current.update(vols[vols.length - 1]);
    }
    lastLen.current = candles.length;
    lastAsset.current = selected;
  }, [candles, selected]);

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="chart-head">
        <span className="sym" style={nation ? { color: nation.color } : undefined}>
          {selected}
        </span>
        <span className="dim">{info?.name}</span>
        {info?.sector && <span className="tag">{SECTOR_LABEL[info.sector]}</span>}
        {nation && <span className="tag" style={{ borderColor: nation.color, color: nation.color }}>{nation.name}</span>}
        <span style={{ flex: 1 }} />
        {quote && (
          <>
            <span className="px">{fmtPrice(quote.price)}</span>
            <span className={`num ${quote.change >= 0 ? 'up' : 'down'}`}>{fmtPct(quote.change)} tick</span>
            <span className={`num ${quote.changeTotal >= 0 ? 'up' : 'down'}`}>{fmtPct(quote.changeTotal)} game</span>
            {quote.halted && <span className="halt">HALTED NEXT ROUND</span>}
          </>
        )}
      </div>
      <div className="chart-box" ref={box} />
    </div>
  );
}
