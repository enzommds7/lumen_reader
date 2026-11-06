# Lúmen Reader — PWA pessoal (v1.1)

Leitor **mobile-first** para iPhone e Android, desenvolvido em HTML, CSS e JavaScript puro. O aplicativo usa **PDF.js**, **IndexedDB** e **Service Worker**; não requer conta.

## Correção v1.1 (layout)

- O diálogo **Destaques e favoritos** não aparece mais sozinho na tela inicial: o estilo `.annotations-dialog {display:flex}` agora só atua quando `<dialog open>`.
- Ajustadas as dimensões e o espaçamento das caixas de diálogo em celulares pequenos, preservando os espaços seguros do iPhone 15.
- A decoração da capa foi deslocada no celular para não atrapalhar o texto.
- O cache do Service Worker passou para `lumen-reader-shell-v1.1.0`. Depois de atualizar o código publicado, **recarregue o site uma ou duas vezes** para ativar a nova versão. Não apague os dados do site nem desinstale o PWA se já tiver livros armazenados.

## O que já está implementado

- Biblioteca pessoal com importação de PDFs pelo app **Arquivos**, mais **um PDF de demonstração** para testar na primeira abertura.
- Leitura em **PDF original** (canvas, camada de seleção de texto) ou **modo adaptável**, com paginação e ajuste de fonte.
- Marcadores de página, **destaques em quatro cores**, notas e caderno de marcações, separados por livro.
- Progresso de leitura salvo automaticamente; temas claro, sépia e escuro.
- Exportação de marcações em `.md`.
- Backup completo em `.json` com livros, notas e progresso, além de restauração (limite prático recomendado: 85 MB para o conjunto).
- PWA instalável pelo Safari, interface com `safe-area-inset-*` e cache offline dos recursos depois do primeiro acesso conectado.
- Importação por URL direta de PDF se a origem aceitar CORS; **servidor opcional** para resolver URLs de páginas que expõem PDFs públicos.

## Testar no Windows / VS Code

1. Instale **Node.js 20 ou mais recente**.
2. Extraia o ZIP e abra a pasta no VS Code.
3. No terminal da pasta, rode `npm start`.
4. No navegador, entre em **http://127.0.0.1:8000**.
5. Clique em **Experimentar um livro de demonstração** ou **Adicionar livro → Escolher PDF** e experimente os dois modos.

Não precisa executar `npm install` (o servidor usa apenas módulos nativos do Node). Rode `npm test` para executar o teste de extração de texto incluído.

> **Internet na primeira execução:** PDF.js é carregado do CDN Cloudflare (versão fixada 4.10.38). O Service Worker tenta armazenar os arquivos para a próxima vez. Não é totalmente independente da rede na primeira abertura.

## Testar no iPhone 15

### Opção A — GitHub Pages (mais fácil)

1. Crie um repositório GitHub público e envie **o conteúdo da pasta** (não o ZIP).
2. Vá a **Settings → Pages** e configure deploy da branch principal, pasta `/ (root)`.
3. Abra a URL HTTPS publicada pelo Safari do iPhone.
4. Compartilhar → **Adicionar à Tela de Início** → abrir como aplicativo, quando oferecido.
5. Importe os PDFs pelo app Arquivos. Depois da primeira abertura conectada, teste o uso offline.

**Limitação importante:** GitHub Pages só publica arquivos estáticos. Nesse modo, importação de link de *página* (por exemplo `https://www.literamundo.com.br/livro/a-gaia-ciencia`) **não funciona automaticamente**. Links diretos de PDF só funcionam se o site permitir CORS. Alternativa: abra o PDF no Safari, salve em Arquivos e importe no Lúmen.

### Opção B — Servidor Node.js (importação por link)

Rode `npm start`. O servidor entrega o PWA e a rota `POST /api/import`, que tenta localizar e baixar PDFs publicamente acessíveis. Por padrão só permite importar de `literamundo.com.br` e `www.literamundo.com.br` como proteção contra uso indevido do proxy. Para outros domínios de que você tenha permissão:

- Linux/macOS: `ALLOWED_HOSTS=www.literamundo.com.br,literamundo.com.br,example.org npm start`
- PowerShell: `$env:ALLOWED_HOSTS="www.literamundo.com.br,literamundo.com.br,example.org"; npm start`

Para instalar no iPhone pelo Safari, hospede **app + servidor** em um endereço HTTPS público. O Node local em `127.0.0.1` do Windows não é alcançável pelo iPhone. Um serviço como Render/Railway pode hospedar o Node (verifique os preços e as condições atuais). Ajuste `HOST=0.0.0.0` e `PORT` conforme o provedor. Não exponha um proxy aberto indiscriminadamente na internet.

**O resolvedor não contorna login, paywalls, DRM, proteções anti-bot ou restrições de acesso.** Sites carregados só por JavaScript e URLs de arquivo sem referência explícita no HTML podem não ser identificados. Para esses casos, faça o download permitido e importe o arquivo.

## Como selecionar e destacar

No **modo adaptável**, pressione e arraste sobre o texto ou use a seleção do iPhone. Aparece a barra com quatro cores e botões **Destacar** e **+ Nota**.

No **PDF original**, a seleção usa a camada de texto do PDF.js. O destaque é salvo como retângulos relativos à página (não altera o PDF original). Para arquivos digitalizados sem texto selecionável, não há seleção de trecho — use notas e favoritos de página.

## Limitações que vale conhecer

- O modo adaptável **extrai o texto**, mas não reproduz fielmente ilustrações, notas de rodapé, tabelas, poemas nem PDFs em múltiplas colunas. Não há OCR. Para esses livros, use o PDF original.
- A contagem de páginas adaptáveis muda com fonte, orientação e tamanho de tela; o progresso no modo adaptável é guardado pela **posição do texto**, não pelo número da página.
- Marcadores, destaques e notas ficam **somente neste dispositivo e nesta instalação do PWA**. Safari e PWA podem ter espaços de armazenamento separados. Faça backup regularmente.
- Não há sincronização com iCloud/Google Drive, login ou envio de PDFs ao servidor de importação (a importação por link só baixa do URL público informado).
- O sistema pode apagar dados do navegador em caso de pressão de espaço ou outras políticas de armazenamento. **Não use como único lugar para guardar seus livros**.
- Em iOS, arquivos muito grandes ou backups com muitos PDFs podem exceder a memória disponível.
- PDF.js depende de CDN na primeira carga; se o CDN estiver indisponível, a biblioteca continua abrindo, mas a visualização do PDF não funcionará até se conectar.

## Estrutura

```
index.html             Telas, caixas de diálogo, toolbar
style.css              Layout mobile e áreas seguras do iOS
manifest.webmanifest   Instalação como PWA
sw.js                  Cache do app e dependências PDF.js
js/db.js               IndexedDB: books, files, extracted, annotations
js/pdf.js              Render e extração via PDF.js
js/app.js              Biblioteca, paginação, marcadores, UI e backups
assets/*               Ícones
server/server.mjs      Servidor HTTP/JSON e resolvedor de PDF público (opcional)
```

## Testes sugeridos no iPhone

1. Importar um PDF simples, abrir original e adaptável, ir a páginas seguintes.
2. Trocar fonte e alternar os temas, fechar/reabrir, observar o progresso.
3. Destacar e anotar um trecho; criar um favorito; revisar no caderno.
4. Exportar `.md`, fazer backup `.json` e conferir no app Arquivos.
5. Adicionar à tela inicial, testar sem internet **após concluir a primeira carga conectada**.
6. Reabrir em modo retrato e paisagem e verificar Dynamic Island/área inferior.

**Privacidade e direitos autorais:** importe apenas PDFs que você pode ler ou baixar legitimamente. O leitor não quebra DRM.
