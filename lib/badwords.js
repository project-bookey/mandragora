// Simple word filter shared by the page and the API route.
// Spaces, digits and symbols are stripped first so "시 1 발" still matches.
export const BAD = ["시발","씨발","씨빨","씨바","시빨","ㅅㅂ","ㅆㅂ","ㅆㅃ","병신","븅신","빙신","ㅂㅅ","ㅄ","좆","존나","졸라","ㅈㄴ","ㅈ같","개새","새끼야","ㅅㄲ","지랄","ㅈㄹ","미친놈","미친년","썅","니미","느금","니애미","애미","엠창","염병","섹스","sex","fuck","shit","bitch","야동","딸딸이","강간","틀딱","급식충","맘충","한남충","김치녀","된장녀","짱깨","쪽바리","깜둥","똥꼬충","일베","메갈","홍어새"];
export const normalize = s => String(s).toLowerCase().normalize("NFC").replace(/[^a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, "");
export const badWord = s => { const t = normalize(s); return BAD.some(w => t.includes(w)); };
