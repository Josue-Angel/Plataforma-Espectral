# Cómo evitar el error al usar clave SMTP2GO en RESEND_API_KEY

Si colocas una clave de SMTP2GO (normalmente empieza con `api-...`) en `RESEND_API_KEY`, Resend fallará.

## Correcto
- `RESEND_API_KEY`: **solo** clave de Resend.
- `SMTP2GO_API_KEY`: clave de SMTP2GO (`api-...`).

## Qué hace ahora la app
- Detecta si `RESEND_API_KEY` parece clave SMTP2GO (`api-...`) y la usa como fallback SMTP2GO.
- Aun así, lo recomendado es colocar cada clave en su variable correcta.

## Configuración mínima recomendada
```html
window.RESEND_API_KEY = '';
window.BREVO_API_KEY = '';
window.SMTP2GO_API_KEY = 'api-XXXXXXXX';
window.NOTIFICATION_FROM_EMAIL = 'remitente-verificado@tudominio.com';
window.SUPABASE_EMAIL_FUNCTION = 'send-email';
```

## Orden de intento de envío
1. Resend (si `RESEND_API_KEY` existe)
2. Brevo (si `BREVO_API_KEY` existe)
3. SMTP2GO (si `SMTP2GO_API_KEY` existe, o si detecta clave SMTP2GO en `RESEND_API_KEY`)
4. Supabase Edge Function (`send-email`)
