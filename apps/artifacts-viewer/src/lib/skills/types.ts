export interface Skill {
  name: string;
  description: string;
  content: string;
}

export interface ListSkillsResponsePayload {
  skills: Skill[];
}

export interface CreateSkillPayload {
  name: string;
  description: string;
  content: string;
}

export interface UpdateSkillPayload {
  description: string;
  content: string;
}
