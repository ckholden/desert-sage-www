/**
 * Fetches and renders guest reviews (Airbnb + Google) from Desert Sage
 * Tasks' public API — replaces the broken TrustIndex embed. Shared across
 * pages the same way styles.css is (one file, no build step); extracted
 * out of the individual pages rather than duplicated because the render
 * logic is ~100 lines, unlike the 6-line hamburger-nav script that's
 * still duplicated inline per page.
 */
(function () {
  var API_URL = 'https://tasks.desertsagerentals.com/api/public/reviews';
  var containers = document.querySelectorAll('[data-reviews-widget]');
  if (!containers.length) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stars(r) {
    var full = Math.round(r || 0);
    return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
  }

  function relativeTime(iso) {
    if (!iso) return '';
    var days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days < 1) return 'Today';
    if (days < 30) return days + ' day' + (days === 1 ? '' : 's') + ' ago';
    var months = Math.floor(days / 30);
    if (months < 12) return months + ' month' + (months === 1 ? '' : 's') + ' ago';
    var years = Math.floor(months / 12);
    return years + ' year' + (years === 1 ? '' : 's') + ' ago';
  }

  function renderCard(r) {
    var name = r.reviewer_name || 'Guest';
    var initials = name.trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase();
    var photo = r.reviewer_photo_url
      ? '<img class="review-card__avatar" src="' + esc(r.reviewer_photo_url) + '" alt="" loading="lazy" width="48" height="48">'
      : '<div class="review-card__avatar review-card__avatar--fallback">' + esc(initials) + '</div>';
    var badge = r.source === 'google'
      ? '<span class="review-card__badge review-card__badge--google">Google</span>'
      : '<span class="review-card__badge review-card__badge--airbnb">Airbnb</span>';
    return '<article class="review-card">' +
      '<div class="review-card__head">' +
        photo +
        '<div class="review-card__id">' +
          '<div class="review-card__name">' + esc(name) + '</div>' +
          '<div class="review-card__meta">' + stars(r.rating) + ' <span class="review-card__date">' + esc(relativeTime(r.review_date)) + '</span></div>' +
        '</div>' +
        badge +
      '</div>' +
      '<p class="review-card__text">' + esc(r.review_text) + '</p>' +
    '</article>';
  }

  containers.forEach(function (el) { el.innerHTML = '<p class="reviews-loading">Loading reviews…</p>'; });

  fetch(API_URL)
    .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function (data) {
      var reviews = Array.isArray(data.reviews) ? data.reviews : [];
      containers.forEach(function (el) {
        var limit = parseInt(el.getAttribute('data-reviews-limit') || '0', 10) || reviews.length;
        var slice = reviews.slice(0, limit);
        el.innerHTML = slice.length
          ? '<div class="review-grid">' + slice.map(renderCard).join('') + '</div>'
          : '<p class="reviews-empty">Reviews are on their way — check back soon!</p>';
      });
    })
    .catch(function () {
      containers.forEach(function (el) {
        el.innerHTML = '<p class="reviews-empty">We couldn’t load reviews right now — please check back shortly.</p>';
      });
    });
})();
