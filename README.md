# 만드라고라

흰 바탕에 만드라고라가 잔뜩 심겨 있는 원페이지 웹사이트입니다.
잎을 잡고 위로 당기면 만드라고라가 뽑히면서 누군가 입력해 둔 말을 외치고, 손을 놓으면 사라집니다.
아래 입력창에 쓴 말은 공유 저장소에 쌓이고, 다음 방문자들의 만드라고라에서 무작위로 나옵니다.

- Next.js 14 (App Router) + TypeScript
- SQLite 영구 저장 (기본) / Supabase 저장 + 실시간 반영 (선택)
- 효과음은 파일 없이 브라우저에서 합성 (Web Audio)

## 구조

```
app/
  page.tsx               화면 + 저장소 연결 (SQLite: 5초 갱신, Supabase: 실시간 구독)
  layout.tsx             폰트, 메타데이터
  globals.css            전체 스타일
  api/mandrakes/route.ts 말 저장 API (길이·욕설 검사, IP당 30초 제한, service role로 insert)
lib/
  engine.js              밭 배치, 뽑기/버둥거림, 잎 생성, 사운드, 입력 처리
  badwords.js            욕설 목록 필터 (화면과 API가 함께 사용)
  supabase.ts            브라우저용(읽기 전용) / 서버용 클라이언트
  messages.ts            SQLite 저장소, 재시작 후에도 유지되는 30초 입력 제한
public/sprites/          만드라고라 몸통 이미지 10종
supabase/
  schema.sql             테이블, RLS(읽기만 공개), 실시간 설정
  seed.sql               기본 문장 70개
```

## 로컬에서 실행하기

Node.js 24 이상에서 별도 환경변수 없이 실행할 수 있습니다.

```bash
npm ci
npm run dev
```

http://localhost:3000 에서 확인할 수 있습니다. 문장은 `.data/messages.sqlite3`에 저장됩니다.
원본 기본 문장 70개는 최초 생성 때만 넣습니다. `MANDRAGORA_MESSAGES_DB`로 DB 경로를 바꿀 수 있습니다.

### Supabase를 사용하는 경우

1. [Supabase](https://supabase.com)에서 새 프로젝트를 만듭니다.
2. Supabase 대시보드 > SQL Editor에서 `supabase/schema.sql`을 실행한 뒤 `supabase/seed.sql`을 실행합니다.
3. `env.example`을 `.env.local`로 복사하고 세 Supabase 값을 모두 채웁니다.
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Project Settings > API
   - `SUPABASE_SERVICE_ROLE_KEY`: 같은 화면의 service_role 키 (서버에서만 사용, 공개 금지)
4. 실행합니다.
   ```bash
   npm install
   npm run dev
   ```
   http://localhost:3000 에서 확인할 수 있습니다.

## 배포할 때

운영 주소: https://www.bookey.site/mandragora/

`main`에 push하면 `.github/workflows/deploy.yml`이 ARM64 GitHub 호스팅 실행기에서 빌드하고
실제 앱의 저장·입력 제한·재시작 보존을 검증합니다. 이후 서버의 전용 실행기
`mandragora-prod-ec2`가 배포합니다. PR 코드는 이 서버 실행기에서 실행하지 않습니다.

- 실행: systemd `mandragora`, `127.0.0.1:3211`, Node.js 24 standalone 앱
- 릴리스: `/opt/mandragora/releases/<SHA>`, 현재 경로: `/opt/mandragora/current`
- 문장 DB: `/var/lib/mandragora/messages.sqlite3` (재배포와 독립)
- 백업: `mandragora-messages-backup.timer`가 매일 SQLite 스냅샷 생성, 최근 14개 보관
- 백업 위치: `/var/lib/mandragora/message-backups/` (같은 서버 디스크)
- `/mandragora/` 경로만 Nginx로 프록시합니다. 다른 서비스는 기존 구성을 사용합니다.
- 배포 중 상태 확인이 실패하면 이전 릴리스·systemd·Nginx 설정으로 복원합니다.
- 기존 농장 릴리스와 `/var/lib/mandragora/farm.sqlite3`, 농장 백업 작업은 보존합니다.

```bash
curl --fail https://www.bookey.site/mandragora/api/health/
sudo systemctl status mandragora
sudo journalctl -u mandragora -n 50
```

Supabase로 배포하려면 GitHub 저장소 Secrets에 `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`를 등록하고 `/etc/mandragora.env`에 URL과
`SUPABASE_SERVICE_ROLE_KEY`를 지정한 뒤 다시 배포합니다.

## 참고

- Supabase 사용 시 브라우저는 anon 키로 **읽기만** 할 수 있고, 저장은 `/api/mandrakes/`를 거쳐서만 됩니다.
  그래서 욕설 필터와 글자 수 제한을 우회할 수 없습니다.
- SQLite의 30초 입력 제한은 DB 트랜잭션으로 처리하며 재시작해도 유지됩니다.
  Supabase의 입력 제한은 서버 메모리 기준이라, 서버리스 환경에서는 인스턴스마다 따로 셉니다.
  더 엄격하게 막으려면 Supabase 테이블이나 Redis 등에 기록하는 방식으로 바꾸면 됩니다.
- 만드라고라 몸통 이미지를 바꾸려면 `public/sprites/`의 파일을 교체하고,
  `lib/engine.js`의 `BODIES` 목록을 맞춰주세요. 이미지는 360×600 투명 PNG/WebP,
  정수리(잎이 붙는 곳)가 위에서 208px 지점 가운데에 오도록 맞추면 됩니다.
