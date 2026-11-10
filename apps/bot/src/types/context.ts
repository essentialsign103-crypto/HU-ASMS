// HU-ASMS: grammY Bot Context and Session Types
import { Context, SessionFlavor } from 'grammy';
import { Conversation, ConversationFlavor } from '@grammyjs/conversations';
import type { Student, Profile, RepresentativeAssignment } from '@hu-asms/types';

export interface SessionData {
  step?: string;
  registrationDraft?: {
    hu_student_id?: string;
    full_name?: string;
    department_id?: string;
    academic_year_id?: string;
    section_id?: string;
    phone?: string;
  };
  activeStudent?: Student | null;
  activeRepresentative?: {
    profile: Profile;
    assignments: RepresentativeAssignment[];
  } | null;
}

export type BotContext = Context & SessionFlavor<SessionData> & ConversationFlavor;
export type BotConversation = Conversation<BotContext>;
