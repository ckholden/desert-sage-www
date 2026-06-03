#!/usr/bin/env node
'use strict';
/**
 * build-rentals.js — regenerates the static rental cards + JSON-LD on
 * rentals.html from properties.json.
 *
 * WHY: the gallery used to render client-side (fetch + JS), so crawlers saw
 * an empty page. This bakes the property content into the HTML so Google
 * indexes names, descriptions, locations, and images — and adds LodgingBusiness
 * structured data. properties.json stays the single source of truth.
 *
 * WORKFLOW to add/rename a property:
 *   1. edit properties.json (+ drop a photo in images/properties/)
 *   2. run: node build-rentals.js
 *   3. commit + push
 */
const fs = require('fs');
const props = require('./properties.json');
const SITE = 'https://desertsagerentals.com';
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// --- Cards (static HTML, same markup the CSS already targets) ---
const cards = props.map(p =>
`      <article class="rental-card">
        <img class="rental-card__img" src="${esc(p.image)}" alt="${esc(p.name)} — ${esc(p.location)}" loading="lazy" width="900" height="600">
        <div class="rental-card__body">
          ${p.location ? `<div class="rental-card__loc">${esc(p.location)}</div>` : ''}
          <h2 class="rental-card__name">${esc(p.name)}</h2>
          <p class="rental-card__blurb">${esc(p.blurb)}</p>
          <div class="rental-card__actions">
            <a class="rental-card__btn" href="${esc(p.bookDirectUrl)}" target="_blank" rel="noopener">Book Direct &amp; Save</a>
            ${p.airbnbUrl ? `<a class="rental-card__btn rental-card__btn--alt" href="${esc(p.airbnbUrl)}" target="_blank" rel="noopener">Book on Airbnb</a>` : ''}
          </div>
        </div>
      </article>`
).join('\n');

// --- JSON-LD: ItemList of LodgingBusiness ---
const itemList = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Desert Sage Rentals — Vacation Homes in Central Oregon',
  itemListElement: props.map((p, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'LodgingBusiness',
      name: p.name,
      description: p.blurb,
      image: SITE + '/' + p.image,
      url: SITE + '/rentals',
      address: {
        '@type': 'PostalAddress',
        addressLocality: (p.location || '').split('·')[0].split(',')[0].trim() || 'Prineville',
        addressRegion: 'OR',
        addressCountry: 'US'
      }
    }
  }))
};
const ld = '<script type="application/ld+json">\n' + JSON.stringify(itemList, null, 2) + '\n  </script>';

// --- Inject between markers ---
let html = fs.readFileSync('rentals.html', 'utf8');
html = html.replace(/<!-- CARDS:START -->[\s\S]*?<!-- CARDS:END -->/, '<!-- CARDS:START -->\n' + cards + '\n      <!-- CARDS:END -->');
html = html.replace(/<!-- LD:START -->[\s\S]*?<!-- LD:END -->/, '<!-- LD:START -->\n  ' + ld + '\n  <!-- LD:END -->');
fs.writeFileSync('rentals.html', html);
console.log('Built ' + props.length + ' cards + LodgingBusiness JSON-LD into rentals.html');
