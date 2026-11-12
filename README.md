# 소리결 한국어 TTS

브라우저에서 실행되는 무료 텍스트 음성 변환 웹앱입니다.

## 기능
- 한국어 / 영어 / 일본어
- 여성 3종, 남성 3종 음성 선택 및 미리듣기
- 속도 및 음성 생성 품질 조절
- 긴 글 자동 분할 처리
- TXT / DOCX 파일 불러오기
- 음성 재생 및 WAV 다운로드
- 서버로 글을 보내지 않고 브라우저에서 음성 생성

## 사용
웹사이트: https://nolc74.github.io/gpt3/

최초 실행 시 음성 모델 파일을 브라우저가 Hugging Face에서 내려받습니다. 모델 크기가 커서 첫 실행에는 시간이 걸릴 수 있습니다. 이후에는 브라우저 캐시를 활용합니다.

## 배포
GitHub Actions가 main 브랜치 변경 시 자동으로 빌드하고 GitHub Pages에 배포합니다.
GitHub 저장소 Settings → Pages → Build and deployment → Source를 GitHub Actions로 설정해야 합니다.

## 기반 기술 및 라이선스
이 웹앱은 [Supertonic 3](https://github.com/supertone-inc/supertonic) 모델을 사용하는 [cskwork/supertonic-tts](https://github.com/cskwork/supertonic-tts) 웹 프로젝트를 기반으로 구성했습니다. 앱 소스의 라이선스 및 모델 가중치의 사용 조건은 원본 프로젝트와 [Supertone 모델 라이선스](https://huggingface.co/Supertone/supertonic-3)를 따릅니다.
