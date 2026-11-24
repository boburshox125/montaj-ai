# Montaj AI

Premiere Pro uchun AI agent. Buyruqni o'zbekcha yozasiz yoki aytasiz, agent Gemini orqali tushunib, MCP vositalari bilan montajni bajaradi.

## Ishlatish
1. `MontajAI-Setup-*.exe` ni o'rnating (yoki Portable'ni oching).
2. https://aistudio.google.com/apikey dan bepul kalit olib, **Sozlamalar**ga qo'ying.
3. Premiere Pro'da **Window > Extensions > PR MCP Bridge** panelini oching.
4. Buyruq bering.

Premiere MCP (`%LOCALAPPDATA%\PremiereAI`) avtomatik topiladi. Boshqa kompyuterda u alohida o'rnatilgan bo'lishi kerak yoki Sozlamalarda `premiere` nomi bilan qo'shiladi.

## Rejimlar
- **So'rab ishlash**: kesish, o'chirish, eksportdan oldin ruxsat so'raydi.
- **To'liq avtomatik**: so'ramaydi (Premiere skripti bundan mustasno).
- **Faqat reja**: hech narsani o'zgartirmaydi.

## GitHub orqali EXE
Repo'ga yuklang, keyin `v1.0.0` kabi teg (reliz) yarating: GitHub Actions EXE'ni yig'ib Releases'ga qo'yadi. Ochiq repo'da o'rnatilgan dastur yangi versiyani o'zi topadi. Yangi versiya uchun avval `package.json` dagi `version` ni oshiring.

## Ishlab chiqish
`npm ci`, `npm start`, `npm test`, `npm run dist`
