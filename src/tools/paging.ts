import { z } from 'zod';
import type { Pagination } from '../types.js';

/** start / limit inputs for tools that list a page's or wiki's items. */
export const pagingShape = {
  start: z.number().int().min(0).default(0).describe('Offset for pagination (default 0)'),
  limit: z.number().int().min(1).max(500).default(50).describe('Items per call (default 50); keep paging while has_more is true'),
};

/** One page of items plus _pagination; XWiki returns these lists whole, so the total is exact. */
export function pageOf<T>(items: T[], start: number, limit: number): { items: T[]; _pagination: Pagination } {
  return {
    items: items.slice(start, start + limit),
    _pagination: { total: items.length, start, limit, has_more: start + limit < items.length },
  };
}
