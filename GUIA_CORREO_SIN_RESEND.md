# Guía rápida: envío de correos con Gmail + App Password

Esta app ahora utiliza un único flujo de correo: **función Edge de Supabase** con SMTP de Gmail y **App Password**.

## 1) Preparar Gmail
1. Activa la verificación en 2 pasos de tu cuenta de Google.
2. Genera una contraseña de aplicación (App Password de 16 caracteres).
3. Guarda estos valores:
   - `GMAIL_USER` (tu correo Gmail)
   - `GMAIL_APP_PASSWORD` (la contraseña de aplicación)

## 2) Configurar el frontend
En `index.html` se usan estas variables:

```html
window.GMAIL_USER = 'tu_correo@gmail.com';
window.GMAIL_APP_PASSWORD = 'tu_app_password_de_16_caracteres';
window.SUPABASE_EMAIL_FUNCTION = 'send-email';
```

## 3) Configurar función Edge en Supabase (recomendado)
La función `send-email` debe leer `GMAIL_USER` y `GMAIL_APP_PASSWORD` como secretos y enviar correo con Nodemailer.

Flujo que cubre la app:
- Registro de voluntario -> correo al admin.
- Formulario completado -> correo al voluntario con su fototipo.
- Registro en `admin_notificaciones`.

## 4) Seguridad importante
No uses claves reales en repositorio público.
- Usa variables/secretos en Supabase para producción.
- Rota el App Password si se expone.
