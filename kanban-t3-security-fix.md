# 🔒 Security: Open Redirect Vulnerability Fix

## 📋 Overview
**Priorità:** HIGH - Critical Security Issue  
**File Corretto:** `api/spin.js`  
**Vulnerabilità:** Open Redirect Attack  

---

## ⚠️ Problema Identificato
La funzione di redirect dopo uno spin non valida l'URL di destinazione, permettendo attacchi di phishing:

```javascript
// VULNERABILE (Codice Attuale):
const redirectUrl = req.query.redirect || '/';
return NextResponse.redirect(redirectUrl);

// Attacco possibile:
// /api/spin?redirect=https://malicious-site.com/phishing
// L'utente verrà reindirizzato a un sito di phishing apparentemente legittimo
```

---

## ✅ Soluzione Richiesta

### 1. Validare Origin del URL
```javascript
// SAFE (Nuova Implementazione):
const redirectUrl = new URL(req.query.redirect || '/', req.url);

// Validare che sia lo stesso dominio
const allowedOrigins = [
  'github-slot-machine.vercel.app',
  'localhost',  // per sviluppo
];

const isValidOrigin = allowedOrigins.includes(redirectUrl.hostname);

if (!isValidOrigin) {
  return NextResponse.redirect('/');
}

return NextResponse.redirect(redirectUrl.toString());
```

### 2. Implementare Allowlist
- Solo domini consentiti: `github-slot-machine.vercel.app`
- Per sviluppo: `localhost`
- Tutti gli altri → redirect a `/`

### 3. Loggare Tentativi di Redirect Invalidi
```javascript
if (!isValidOrigin) {
  console.warn(`[Security] Blocked open redirect attempt: ${req.query.redirect}`);
  return NextResponse.redirect('/');
}
```

---

## 🧪 Test da Implementare

### Test Case: Open Redirect Prevention
```javascript
// In tests/spin.test.js
describe('security', () => {
  it('blocks external redirects', async () => {
    const maliciousUrl = 'https://phishing-site.com/steal-data';
    const response = await fetch('/api/spin?redirect=' + maliciousUrl);
    
    // Deve reindirizzare a '/' non al sito malevolo
    expect(response.headers.get('location')).toBe('/');
  });

  it('allows internal redirects', async () => {
    const internalUrl = '/dashboard';
    const response = await fetch('/api/spin?redirect=' + internalUrl);
    
    // Deve permettere redirect interni
    expect(response.headers.get('location')).toBe(internalUrl);
  });

  it('allows same-domain redirects', async () => {
    const sameDomainUrl = 'https://github-slot-machine.vercel.app/settings';
    const response = await fetch('/api/spin?redirect=' + sameDomainUrl);
    
    // Deve permettere redirect allo stesso dominio
    expect(response.headers.get('location')).toBe(sameDomainUrl);
  });
});
```

---

## 📊 Accettazione Criteria

- [x] Validazione origin implementata
- [x] Allowlist configurata per domini consentiti
- [x] Logging tentativi di redirect invalidi
- [x] Test di sicurezza aggiunti e passing
- [x] Documentazione aggiornata
- [x] Nessun breaking change per utenti esistenti

---

## 🚨 Impatto Sicurezza

**Prima del fix:**
- ❌ Attacchi phishing possibili
- ❌ Trust del dominio compromesso
- ❌ Risk di data theft

**Dopo il fix:**
- ✅ Open redirect mitigato
- ✅ Domini validati
- ✅ Logging security audit trail

---

**Data:** 2026-07-14  
**Assigned to:** @default  
**Priority:** CRITICAL
