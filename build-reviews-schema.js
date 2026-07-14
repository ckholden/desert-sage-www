#!/usr/bin/env node
'use strict';
/**
 * build-reviews-schema.js — refreshes the AggregateRating JSON-LD on
 * reviews.html from the live public reviews API.
 *
 * WHY: the visible review cards on reviews.html always render live via
 * reviews-widget.js (client-side fetch), but the JSON-LD block is static
 * HTML for crawlers — it goes stale as new reviews land. Re-run this
 * periodically (e.g. after a batch of new reviews comes in) to keep it
 * accurate. No build step / no dependency beyond Node's built-in fetch.
 *
 * WORKFLOW:
 *   1. run: node build-reviews-schema.js
 *   2. commit + push
 */
const fs = require('fs');
const API_URL = 'https://tasks.desertsagerentals.com/api/public/reviews';

(async () => {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error('Reviews API HTTP ' + res.status);
  const data = await res.json();
  const agg = data.aggregate;
  if (!agg || !agg.count) throw new Error('Reviews API returned no aggregate data — aborting, not overwriting with stale/empty values');

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'Desert Sage Rentals',
    url: 'https://desertsagerentals.com',
    telephone: '+1-541-362-1879',
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: String(Math.round(agg.avg_rating * 100) / 100),
      reviewCount: String(agg.count),
      bestRating: '5'
    }
  };
  const block = '<script type="application/ld+json">\n  ' + JSON.stringify(ld, null, 2) + '\n  </script>';

  let html = fs.readFileSync('reviews.html', 'utf8');
  const before = html;
  html = html.replace(/<!-- LD:START -->[\s\S]*?<!-- LD:END -->/, '<!-- LD:START -->\n  ' + block + '\n  <!-- LD:END -->');
  if (html === before) throw new Error('LD:START/LD:END markers not found in reviews.html — aborting');
  fs.writeFileSync('reviews.html', html);
  console.log('Built AggregateRating JSON-LD: ' + ld.aggregateRating.ratingValue + ' stars, ' + ld.aggregateRating.reviewCount + ' reviews');
})().catch(err => {
  console.error('build-reviews-schema.js failed:', err.message);
  process.exit(1);
});
