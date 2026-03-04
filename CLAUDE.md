# Claude Code Instructions - Desert Sage WWW

## Project Overview
Desert Sage Rentals marketing website. Static HTML/CSS/JS, no build step.

**Production URL:** https://desertsagerentals.com
**Repo:** https://github.com/ckholden/desert-sage-www
**Hosting:** GitHub Pages (auto-deploy on push to main)
**Domain DNS:** Managed via Squarespace

## Permissions - FULL ACCESS GRANTED
Claude can execute commands, make changes, and deploy without asking. Push to `main` triggers GitHub Pages deploy.

## Site Structure

| Page | File |
|------|------|
| Home | `index.html` |
| About | `about.html` |
| Service Area | `service-area.html` |
| FAQs | `faqs.html` |
| Reviews | `reviews.html` |
| Contact | `contact.html` |
| Rental Analysis | `rental-analysis.html` |
| Styles | `styles.css` |

## Key Notes
- Google Fonts: Cormorant Garamond (headings) + DM Sans (body)
- Grayscale palette, minimalist design
- Contact form via Formspree (`mjgenydq`)
- Reviews via Trustindex widget embed (`80b094058f3034314226dddb778`)
- FAQ page has JSON-LD FAQPage structured data for Google rich results
- Homepage has JSON-LD LocalBusiness schema
- **Nav must be updated in ALL HTML files when changed**

## Related Subdomains
- `book.desertsagerentals.com` CNAME → Lodgify (booking engine)
- `tasks.desertsagerentals.com` CNAME → Railway (desert-sage-tasks)
- `portal.desertsagerentals.com` CNAME → Railway (owner portal, same app as tasks)

## DNS Records (Squarespace)
- `@` A → 185.199.108-111.154 (GitHub Pages)
- `www` CNAME → `ckholden.github.io`
- `book` CNAME → `app.lodgify.com`
- `tasks` CNAME → `desert-sage-tasks-production.up.railway.app`
- `portal` CNAME → `js32pgrg.up.railway.app`
- `_railway.portal` TXT → `js32pgrg.up.railway.app` (Railway domain verification)
