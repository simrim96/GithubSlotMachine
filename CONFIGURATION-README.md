# 🛠️ GitHub Slot Machine - Configuration Guide

## Overview

This document describes all configuration options for the GitHub Slot Machine project. The slot can be configured via environment variables without modifying any code.

---

## Required Configuration

### GITHUB_PAT (Required)

A fine-grained GitHub Personal Access Token with the following permissions:

- **Contents: Read & Write** on the `GithubSlotMachine` repo
- **Contents: Read & Write** on your profile repo (`<your-user>/<your-user>`)
- **Metadata: Read** (to list your repositories)

**How to create:**
1. Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Click "Generate new token"
3. Set permissions as above
4. Copy the token and add it to your `.env` file

---

## Slot Configuration

### SLOT_OWNER
- **Default:** `simrim96`
- **Purpose:** Owner of the slot repository and whose repositories are scanned for language matches
- **Example:** `SLOT_OWNER=yourgithubusername`

### SLOT_REPO
- **Default:** `GithubSlotMachine`
- **Purpose:** The repository that hosts `slot.svg` and `state.json`
- **Example:** `SLOT_REPO=MySlotMachine`

### PROFILE_REPO
- **Default:** `<SLOT_OWNER>` (same as SLOT_OWNER)
- **Purpose:** Your profile README repository (format: `<user>/<user>`)
- **Example:** `PROFILE_REPO=yourgithubusername/yourgithubusername`

---

## Upstash Redis (Optional but Recommended)

Upstash Redis significantly improves performance by caching `slot.svg` and community counters.

### UPSTASH_REDIS_REST_URL
- **Purpose:** REST URL of your Upstash Redis database
- **How to get:** Create a database at [upstash.com](https://upstash.com)
- **Important:** Choose the SAME region as your Vercel deployment (e.g., `fra1` for Europe)

### UPSTASH_REDIS_REST_TOKEN
- **Purpose:** REST token for authentication
- **How to get:** Generated automatically when you create your Upstash database

**Benefits of Upstash Redis:**
- Image reads drop from ~300ms to ~10ms
- Language→repo cache survives Vercel cold starts
- Non-blocking spin operations
- Automatic fallback to GitHub if Redis is slow

---

## Sentry Error Tracking (Optional)

### SENTRY_DSN
- **Purpose:** Sentry Data Source Name for error tracking
- **How to get:** Create a project at [sentry.io](https://sentry.io)
- **Format:** `https://<key>@o<id>.ingest.sentry.io/<project-id>`

### SENTRY_TRACES_SAMPLE_RATE
- **Default:** `1.0` (100%)
- **Purpose:** Sample rate for transaction traces
- **Range:** `0.0` to `1.0`

### SENTRY_PROFILES_SAMPLE_RATE
- **Default:** `1.0` (100%)
- **Purpose:** Sample rate for performance profiles
- **Range:** `0.0` to `1.0`

---

## Vercel Configuration

### VERCEL_REGION
- **Default:** `fra1` (Europe)
- **Purpose:** Deploy region for your Vercel project
- **Important:** Match this with your Upstash Redis region for optimal performance
- **Available regions:** See [Vercel regions](https://vercel.com/docs/regions)

---

## Development Configuration

### NODE_ENV
- **Default:** `development`
- **Purpose:** Environment mode (development/production)
- **Effects:** Affects logging, error messages, and Sentry debug mode

### VERCEL_ENV
- **Default:** `development`
- **Purpose:** Vercel-specific environment variable
- **Values:** `development`, `preview`, `production`

---

## Configuration Priority

Environment variables take precedence over hardcoded defaults in this order:

1. **Vercel dashboard secrets** (highest priority)
2. **`.env` file** in local development
3. **Hardcoded defaults** in source code (lowest priority)

---

## Quick Start Checklist

- [ ] Create GITHUB_PAT with required permissions
- [ ] Set `GITHUB_PAT` in `.env`
- [ ] Configure `SLOT_OWNER` if different from default
- [ ] (Optional) Set up Upstash Redis for better performance
- [ ] (Optional) Configure Sentry for error tracking
- [ ] Deploy to Vercel with environment variables set
- [ ] Verify deployment by accessing `/api/health`

---

## Security Best Practices

1. **Never commit `.env` to version control** - it's already in `.gitignore`
2. **Use fine-grained tokens** with minimum required permissions
3. **Rotate GITHUB_PAT** periodically (e.g., every 90 days)
4. **Use different tokens** for development and production
5. **Monitor Sentry** for any token-related errors

---

## Troubleshooting

### "GITHUB_PAT required" error
- Check that `GITHUB_PAT` is set in your `.env` file
- Verify the token has the correct permissions
- Ensure the token hasn't expired

### Slow performance
- Set up Upstash Redis
- Ensure Redis region matches Vercel region
- Check Redis connection in Sentry logs

### Redis fallback not working
- Verify both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set
- Check Redis connectivity with a simple curl test
- Look for timeout errors in Sentry

---

## Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Upstash Redis Documentation](https://upstash.com/docs)
- [Sentry Documentation](https://docs.sentry.io)
- [GitHub Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

---

Last updated: 2026-07-16
