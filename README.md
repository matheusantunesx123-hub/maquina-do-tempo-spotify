# Máquina do Tempo Spotify · Versão Amigos (Usuários Ilimitados)

Aplicação web 100% estática (GitHub Pages, R$ 0,00) aberta para **quantas pessoas você quiser** gerarem sua Máquina do Tempo mensal do Spotify e exportarem artes em `1080px` para o Instagram (Story 9:16, Feed 4:5 e Carrossel `.zip` com 5 slides).

## URL Pública
https://matheusantunesx123-hub.github.io/maquina-do-tempo-spotify/

## Modos Ilimitados (sem cadastro de e-mail)

1. **ListenBrainz (`@usuario` — Zero API Key):**
   - Qualquer amigo vincula a conta Spotify em https://listenbrainz.org/settings/music-services/details/ e digita o `@usuario` no site.
   - Suporta busca de qualquer mês específico e busca automática de capas HD.
2. **Last.fm (`@usuario` — Mais Popular):**
   - Qualquer amigo vincula o Spotify em https://www.last.fm/settings/applications e digita o `@usuario`.
   - Basta **1 API Key gratuita** criada em https://www.last.fm/api/account/create e colocada em `defaultLastfmApiKey` no [`config.js`](./config.js) (ou via tela inicial / `?lastfm_key=...`). Essa única chave atende **usuários ilimitados**.
3. **Importar Histórico do Spotify (`.json` ou `.zip` — 100% Offline + Capas HD):**
   - Qualquer amigo arrasta o arquivo baixado do Spotify e o site reconstrói todos os meses reais + busca automaticamente fotos e capas em HD (`500×500`) via Deezer JSONP.

## Modo Secundário: Login Direto Spotify (OAuth 2.0 PKCE)
- Mantido na Opção 3 para você e até 4 amigos próximos cadastrados em **User Management** (limite atual do Spotify Development Mode: 5 contas por Client ID).
- Redirect URI: `https://matheusantunesx123-hub.github.io/maquina-do-tempo-spotify/`
