# CLAUDE.md — instruções para trabalhar neste projeto

## Antes de qualquer alteração
1. Ler `SPEC.md` (o que a app faz) e, se a alteração tocar em dados, `supabase/schema.sql`.
2. Ler o código real dos ficheiros a mudar — não assumir pelo spec; a Ana muda coisas localmente.
3. Para contexto do que já foi decidido ao longo do tempo, a memória tem a área `myseries`.

## Como a Ana trabalha (aprendido)
- Fala em português de Portugal; responder em pt-PT, sem anglicismos desnecessários. Código e comentários também em pt-PT.
- Prefere Angular/TypeScript (é o que conhece melhor). Manter o estilo do projeto: componentes standalone com template inline,
  signals/computed, templates com `@if/@for`, ficheiros curtos e densos, uma linha por regra CSS quando couber.
- Faz pedidos curtos e diretos, muitas vezes em sequência na mesma sessão; implementar logo, explicar em 2–4 frases o que
  mudou e onde, e indicar os passos que ficam para ela (SQL no Supabase, commit, etc.). Nada de listas longas.
- Quando um pedido é ambíguo, implementar a interpretação mais provável e dizer explicitamente qual foi e qual seria a
  alternativa — ela corrige no pedido seguinte (ex.: "Brevemente só a próxima estreia" → afinal queria todos os episódios e o scroll no topo).
- Ela testa com `ng serve` e faz o commit/push ela própria (o `.git` não é visível a partir da ligação do Cowork).
  Dar sempre a mensagem de commit pronta e a lista de ficheiros que devem aparecer no `git status`.
- Prefere decisões explicadas com o "porquê" (ex.: porque é que uma série ficou numa lista) e constantes afináveis em vez de números espalhados.

## Regras do projeto
- **Nunca** meter chaves no repo: `src/environments/environment.ts` e `local/` estão no `.gitignore` (verificar com `git check-ignore -v`).
  O script de importação inicial em `local/` tem chaves reais (service_role do Supabase, token TMDB) — não copiar para fora de `local/`.
- Alterações ao schema: editar `supabase/schema.sql` **e** criar um ficheiro datado `supabase/AAAA-MM-DD-descricao.sql` com só o delta,
  pronto a colar no SQL Editor (vistas: `drop view if exists` + `create or replace view`). Dizer-lhe que tem de o correr.
- Temporada 0 (especiais) fica sempre fora de listas e contagens.
- As datas `watched_at` anteriores a `MIGRATION_DATE` vieram da migração e são todas iguais: nunca as usar como indicador de hábito.
- Em listas com scroll automático lembrar que `.toptabs` é sticky (compensar a altura).
- A pasta `local/` e as outras apps dela (`associacao-fotografarte`, `MyFinances`) vivem em `Documents/My Apps`; só a MySeries está ligada ao Cowork.

## Ao terminar uma alteração
- `npx tsc -p tsconfig.app.json --noEmit` tem de passar (correr na máquina dela via device_bash; a rede dessa VM não chega ao Supabase/TMDB,
  por isso não dá para testar chamadas reais daqui).
- Atualizar `SPEC.md` (secções afetadas + histórico de alterações) e `README.md` se a estrutura/como-funciona mudou.
- Ficheiros temporários: não é possível apagar a partir do Cowork; não os criar dentro do projeto (usar `$HOME` fora de `mnt/`).
