# Guía rápida: envío de correos sin Resend

Si aún no tienes cuenta en Resend, la opción más simple es usar **Brevo (plan gratuito)**.

## 1) Crear cuenta Brevo
1. Crea cuenta en https://www.brevo.com/
2. Verifica un remitente (Sender) en Brevo (tu correo o dominio).
3. Crea una API Key (SMTP & API -> API Keys).

## 2) Configurar la app
En `index.html` configura:

```html
window.BREVO_API_KEY = 'TU_API_KEY_BREVO';
window.NOTIFICATION_FROM_EMAIL = 'remitente_verificado@tudominio.com';
```

> Si dejas `RESEND_API_KEY` vacío, la app intentará Brevo automáticamente.

## 3) Flujo que ya funciona en la app
- Registro de voluntario -> correo al admin.
- Formulario completado -> correo al voluntario con su fototipo.
- También se registra notificación en `admin_notificaciones`.

## 4) Recomendación de seguridad (importante)
Para producción, evita exponer claves en frontend.
Usa una **Supabase Edge Function** (`send-email`) y guarda las claves como `secrets` en Supabase.


## 5) Opción directa con SMTP2GO
Si solo tienes SMTP2GO, usa en `index.html`:

```html
window.SMTP2GO_API_KEY = 'TU_API_KEY_SMTP2GO';
window.NOTIFICATION_FROM_EMAIL = 'remitente@tudominio.com';
```

La app intentará SMTP2GO antes de la función Edge si la clave está definida.
