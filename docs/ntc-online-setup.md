# NTC Online · primeira configuração

## Chaves locais

Copie `.env.online.example` para `.env.online.local` e preencha somente os valores do projeto `ntc-online`:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

`.env.online.local` é ignorado pelo Git. As chaves nunca devem ser substituídas por Secret Key, `service_role` ou senha do banco. `pnpm start` lê o arquivo no desenvolvimento; `pnpm run package:win` gera uma configuração local incluída no instalador para permitir o teste em outros computadores. O Publishable Key é destinado a clientes e a autorização dos dados continua dependendo de Auth e RLS.

## Supabase hospedado

1. No Dashboard do projeto, habilite **Anonymous Sign-Ins** nas configurações de Auth.
2. Abra o SQL Editor e execute o conteúdo de `supabase/migrations/202609260001_ntc_online_profiles.sql`.

A migration configura a tabela pública de leaderboard, RLS e Realtime. Ela pode ser executada novamente; políticas e trigger são recriados e a publicação só recebe a tabela se ainda não estiver inscrita.

## Teste entre dois computadores

1. Gere um instalador com `.env.online.local` configurado e instale a mesma build nos dois PCs.
2. Abra o NTC Utilities; o cliente tenta autenticar e sincronizar em segundo plano, sem pausar o RNG.
3. Em cada instalação, defina um nome local diferente no Perfil. Abra a aba **Online** para acompanhar o ranking.
4. Faça rolls em um dos PCs. A atualização agregada aparece no outro após sincronização ou evento Realtime; o fallback consulta o ranking periodicamente.

As identidades são anônimas e persistidas por instalação. Apagar os dados locais pode tornar a identidade irrecuperável. Os valores de rolls são autodeclarados nesta fundação, não validados contra fraude.
