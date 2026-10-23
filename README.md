# 만드라고라 농장

텍스트로 말을 심고, 누군가가 만드라고라를 뽑으면 그 말을 읽는 익명의 공유 농장.

운영 경로: https://www.bookey.site/mandragora/

- 1~280자의 속마음·응원·엉뚱한 생각을 심습니다.
- 10초가 지나면 다른 농부가 수확할 수 있습니다. 심은 사람은 자기 식물을 뽑을 수 없습니다.
- 수확 전 공개 API에는 내용이나 작성자 식별자가 포함되지 않습니다.
- 서버의 SQLite 트랜잭션으로 한 만드라고라를 한 농부에게만 전달합니다. 같은 수확의 재요청은 같은 결과를 반환합니다.
- 내가 심은 말과 수확 바구니는 이 브라우저의 익명 쿠키로 연결됩니다. 쿠키 삭제·다른 기기에서는 복구할 수 없습니다.
- 받은 말에 마음을 전하거나 신고해서 내 바구니에서 숨길 수 있습니다. 신고 내용은 DB에 보관되며 자동 판정이나 운영자 검토 UI는 아직 없습니다.
- 로그인·음성 녹음·샘플 메시지는 없습니다. 실제로 심은 말만 농장에 나타납니다.

## 실행과 검증

Python 3.11 이상. 운영 API는 Gunicorn, Nginx, SQLite WAL을 사용합니다. 프런트는 빌드 없는 HTML/CSS/JS입니다. 캐릭터와 풍경은 코드로 그린 원본 SVG 픽셀 아트입니다.

```sh
python3 test/serve.py
# http://127.0.0.1:8322/mandragora/
python3 -m unittest discover -s test -p 'test_*.py' -v
```

## 배포

부키 서버의 독립 systemd 서비스 `mandragora`, 포트 `127.0.0.1:3211`, 전용 사용자 `mandragora`를 사용합니다. DB는 `/var/lib/mandragora/farm.sqlite3`, 릴리스는 `/opt/mandragora/releases/<SHA>`, 현재 릴리스는 `/opt/mandragora/current`입니다. Nginx `/mandragora/` 경로만 추가합니다.

Git 커밋을 `git archive --format=tar.gz HEAD`로 내보내 업로드하고, 같은 커밋의 `infra/deploy-bookey.sh <archive> <SHA>`를 root로 실행합니다. Nginx·DB 백업, API 상태 확인, 실패 시 기존 경로·릴리스 복원 절차를 포함합니다. `mandragora-backup.timer`가 같은 서버 디스크에 매일 SQLite 스냅샷을 만듭니다. 외부 백업은 별도입니다.

```sh
sudo systemctl status mandragora
sudo journalctl -u mandragora -n 50
curl --fail https://www.bookey.site/mandragora/api/health
```
