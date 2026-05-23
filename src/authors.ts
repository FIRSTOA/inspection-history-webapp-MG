// 작성자 명단 — 변경 시 이 파일 수정 후 main에 푸시하면 Vercel이 자동 재배포합니다.

export type AuthorTeam = "팀장" | "A" | "B" | "C" | "D";

export const AUTHOR_TEAMS: AuthorTeam[] = ["팀장", "A", "B", "C", "D"];

export const AUTHOR_BOOK: Record<AuthorTeam, string[]> = {
  "팀장": ["신정훈"],
  A: ["김정민", "심태현", "정웅", "고태훈"],
  B: ["권태혁", "조윤", "윤기준", "김대우"],
  C: ["이홍진", "박영현", "이민구", "한왕주"],
  D: ["양승원", "김종희", "이호준"],
};
