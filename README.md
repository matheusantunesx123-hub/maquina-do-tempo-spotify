# Máquina do Tempo Spotify · Versão Amigos (Usuários Ilimitados)

Aplicação web 100% estática (GitHub Pages, R$ 0,00) com entrada simplificada em 1 passo para **quantas pessoas você quiser** gerarem sua Máquina do Tempo mensal do Spotify e exportarem artes em `1080px` para o Instagram (Story 9:16, Feed 4:5 e Carrossel `.zip` com 5 slides).

## URL Pública
https://matheusantunesx123-hub.github.io/maquina-do-tempo-spotify/

## Entrada Fácil (Padrão na Tela Inicial)

1. **Conectar em 15s + Entrar com `@usuario` ou link do perfil:**
   - Qualquer amigo vincula a conta Spotify em https://listenbrainz.org/settings/music-services/details/ e digita o `@usuario` ou cola direto o link `listenbrainz.org/user/seunome` (também aceita links `last.fm/user/seunome`).
   - **Auto-login local:** após entrar a primeira vez, o acesso fica salvo no navegador para abrir direto nos próximos acessos (basta clicar em **Trocar conta** para sair ou mudar de usuário).
   - **Link compartilhável direto:** após entrar, o botão **Copiar link** gera `?u=seunome` para enviar aos amigos ou salvar nos favoritos.
   - **Espera inteligente para contas novas:** se o ListenBrainz ainda estiver importando o Spotify pela primeira vez, a página verifica automaticamente a cada 25s até liberar o painel.
2. **Last.fm (`@usuario`):**
   - Basta **1 API Key gratuita** criada em https://www.last.fm/api/account/create e colocada em `defaultLastfmApiKey` no [`config.js`](./config.js) (ou via interface / `?lastfm_key=...`). Essa única chave atende **usuários ilimitados**.

## Outras Formas de Entrar (Gaveta Recolhida)
- **Importar Histórico do Spotify (`.json` ou `.zip` + Capas HD Deezer JSONP):** processamento 100% local neste aparelho.
- **Login Direto Spotify (OAuth 2.0 PKCE):** mantido na gaveta para você e até 4 amigos na Allowlist (`https://matheusantunesx123-hub.github.io/maquina-do-tempo-spotify/`).
