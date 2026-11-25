# Máquina do Tempo Spotify · Edição Amigos

Aplicação web 100% estática (GitHub Pages, R$ 0,00) para qualquer amigo conectar a própria conta do Spotify via **OAuth 2.0 PKCE** (ou importar seu histórico `.json`/`.zip` do Spotify) e exportar artes em alta resolução (`1080×1920` Story, `1080×1350` Feed e Carrossel `.zip` de 5 slides) para o Instagram.

## URL Pública
https://matheusantunesx123-hub.github.io/maquina-do-tempo-spotify/

## Como ativar o login oficial do Spotify para seus amigos

1. Acesse o [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), abra seu App (ou crie um novo app marcando **Web API**).
2. Em **Settings → Redirect URIs**, adicione exatamente:
   ```text
   https://matheusantunesx123-hub.github.io/maquina-do-tempo-spotify/
   ```
3. Copie o **Client ID** (público — **nunca** coloque o `Client Secret` aqui) e cole em `defaultClientId` no arquivo [`config.js`](./config.js), ou passe na URL `?client_id=SEU_CLIENT_ID` / na tela inicial do app.
4. **Regra do Development Mode (Spotify 2026):** em *Settings → User Management*, cadastre o **e-mail da conta Spotify** de cada amigo que for fazer login (limite atual de até 5 usuários por Client ID no modo Development).
5. **Alternativa sem limite de amigos:** qualquer pessoa pode baixar o histórico oficial na conta do Spotify e arrastar o `.zip` ou os arquivos `Streaming_History_Audio_*.json` direto na tela inicial — tudo é processado localmente no navegador sem enviar dados a nenhum servidor.
