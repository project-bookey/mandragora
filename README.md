# 만드라고라

흰 바탕에 만드라고라가 잔뜩 심겨 있는 원페이지 웹사이트입니다.
잎을 잡고 위로 당기면 만드라고라가 뽑히면서 누군가 입력해 둔 말을 외치고, 손을 놓으면 사라집니다.
아래 입력창에 쓴 말은 공유 저장소에 쌓이고, 다음 방문자들의 만드라고라에서 무작위로 나옵니다.

- Next.js 14 (App Router) + TypeScript
- Supabase (Postgres 저장 + 실시간 반영)
- 효과음은 파일 없이 브라우저에서 합성 (Web Audio)

## 구조

```
app/
  page.tsx               화면 마크업 + Supabase 연결 (읽기/실시간/저장 API 호출)
  layout.tsx             폰트, 메타데이터
  globals.css            전체 스타일
  api/mandrakes/route.ts 말 저장 API (길이·욕설 검사, IP당 30초 제한, service role로 insert)
lib/
  engine.js              밭 배치, 뽑기/버둥거림, 잎 생성, 사운드, 입력 처리
  badwords.js            욕설 목록 필터 (화면과 API가 함께 사용)
  supabase.ts            브라우저용(읽기 전용) / 서버용 클라이언트
public/sprites/          만드라고라 몸통 이미지 10종
supabase/
  schema.sql             테이블, RLS(읽기만 공개), 실시간 설정
  seed.sql               기본 문장 70개
```

## 로컬에서 실행하기

1. [Supabase](https://supabase.com)에서 새 프로젝트를 만듭니다.
2. Supabase 대시보드 > SQL Editor에서 `supabase/schema.sql`을 실행한 뒤 `supabase/seed.sql`을 실행합니다.
3. `.env.local.example`을 `.env.local`로 복사하고 값을 채웁니다.
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Project Settings > API
   - `SUPABASE_SERVICE_ROLE_KEY`: 같은 화면의 service_role 키 (서버에서만 사용, 공개 금지)
4. 실행합니다.
   ```bash
   npm install
   npm run dev
   ```
   http://localhost:3000 에서 확인할 수 있습니다.

## 배포할 때

Node.js를 돌릴 수 있는 곳이면 어디든 됩니다 (Vercel, Netlify, 자체 서버 등).
위 3개의 환경변수를 배포 환경에도 똑같이 넣어주세요.

## 참고

- 브라우저는 anon 키로 **읽기만** 할 수 있고, 저장은 `/api/mandrakes`를 거쳐서만 됩니다.
  그래서 욕설 필터와 글자 수 제한을 우회할 수 없습니다.
- 30초 입력 제한은 서버 메모리 기준이라, 서버리스 환경에서는 인스턴스마다 따로 셉니다.
  더 엄격하게 막으려면 Supabase 테이블이나 Redis 등에 기록하는 방식으로 바꾸면 됩니다.
- 만드라고라 몸통 이미지를 바꾸려면 `public/sprites/`의 파일을 교체하고,
  `lib/engine.js`의 `BODIES` 목록을 맞춰주세요. 이미지는 360×600 투명 PNG/WebP,
  정수리(잎이 붙는 곳)가 위에서 208px 지점 가운데에 오도록 맞추면 됩니다.
