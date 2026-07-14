# Deploying Sentry to GithubSlotMachine

## Prerequisites

1. A Sentry account (free tier available at https://sentry.io/)
2. Vercel account and deployed project

## Step 1: Create Sentry Project

1. Go to https://sentry.io/
2. Click "Create Project"
3. Select "Node.js" as the platform
4. Choose "Serverless" or "Node"
5. Copy the **DSN** (Data Source Name) - it looks like:
   ```
   https://xxxx@o123456.ingest.sentry.io/789012
   ```

## Step 2: Configure Vercel Environment Variables

### Via Vercel Dashboard:
1. Go to your project on vercel.com
2. Navigate to **Settings** → **Environment Variables**
3. Add these variables:

```
SENTRY_DSN=https://your-dsn@o123456.ingest.sentry.io/789012
SENTRY_TRACES_SAMPLE_RATE=1.0
SENTRY_PROFILES_SAMPLE_RATE=1.0
```

### Via CLI:
```bash
vercel env add SENTRY_DSN
vercel env add SENTRY_TRACES_SAMPLE_RATE
vercel env add SENTRY_PROFILES_SAMPLE_RATE
```

## Step 3: Redeploy

After adding the environment variables, redeploy:

```bash
vercel deploy --prod
```

## Step 4: Verify Sentry is Working

1. Go to your Sentry dashboard
2. Wait a few minutes for events to arrive
3. Check **Issues** tab - you should start seeing errors
4. Check **Performance** tab - you should see transaction traces

## Testing

### Test Error Capture

You can trigger a test error to verify Sentry is working:

```bash
# Add this temporarily to one of your handlers
throw new Error('Sentry test error');
```

Or use the Sentry CLI to send a test event:

```bash
npm install -g @sentry/cli
sentry-cli send-envelope
```

### Test Performance Monitoring

1. Run the slot machine several times
2. Go to Sentry → **Performance** tab
3. You should see transactions like:
   - `spin_handler`
   - `ghGet`
   - `ghPut`
   - `kvGet`
   - `kvSet`

## Environment Variables Reference

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `SENTRY_DSN` | Your Sentry DSN | - | `https://xxx@o123@ingest.sentry.io/123` |
| `SENTRY_TRACES_SAMPLE_RATE` | % of traces to sample | `1.0` (100%) | `0.5` (50%) |
| `SENTRY_PROFILES_SAMPLE_RATE` | % of profiles to sample | `1.0` (100%) | `0.5` (50%) |

## Tips

### Sample Rates for Cost Optimization

If you want to reduce costs:
```
SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% of traces
SENTRY_PROFILES_SAMPLE_RATE=0.05  # 5% of profiles
```

### Debug Mode

Enable debug logging in development:
```bash
SENTRY_DEBUG=true vercel dev
```

### Filtering Sensitive Data

Sentry automatically filters passwords, but you can configure more:

```javascript
// In sentry.config.js
Sentry.init({
  // ... other config
  beforeSend(event, hint) {
    // Remove sensitive data before sending
    if (event.tags) {
      delete event.tags.password;
      delete event.tags.token;
    }
    return event;
  },
});
```

## Troubleshooting

### "No events received"

1. Verify `SENTRY_DSN` is correctly set in Vercel
2. Check if the app is actually running
3. Look at Vercel logs for any Sentry initialization errors

### "Rate limit errors"

Sentry has its own rate limits. If you see rate limit errors:
- Reduce `SENTRY_TRACES_SAMPLE_RATE`
- Check your Sentry plan limits

### "Performance data missing"

1. Ensure `SENTRY_TRACES_SAMPLE_RATE > 0`
2. Wait a few minutes for data to process
3. Check Vercel logs for any errors

## Resources

- [Sentry Node.js Documentation](https://docs.sentry.io/platforms/javascript/guides/node/)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [Sentry Cost Optimization](https://docs.sentry.io/product/billing/optimize-cost/)
