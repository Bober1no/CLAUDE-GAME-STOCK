import { CONFIG, type NewsItem, type NewsSource } from '@warmarket/shared';
import { uid } from '../util/rng.js';
import type { Emitter } from '../net/emitter.js';

/** Public news feed. Everything posted here is visible to every player. */
export class NewsService {
  private items: NewsItem[] = [];

  constructor(private emit: Emitter) {}

  post(source: NewsSource, headline: string, tone: NewsItem['tone'] = 'neutral', breaking = false, tickers?: string[]): NewsItem {
    const item: NewsItem = { id: uid('nw'), t: Date.now(), source, headline, tone, breaking, tickers };
    this.items.unshift(item);
    if (this.items.length > CONFIG.events.newsHistory) this.items.pop();
    this.emit.toAll('news', item);
    return item;
  }

  backlog(): NewsItem[] {
    return this.items.slice(0, 40);
  }

  all(): NewsItem[] {
    return this.items;
  }
}
