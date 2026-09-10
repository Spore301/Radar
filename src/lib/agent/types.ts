import type { MergedConstraints, XRayQuery } from '../types';

// ---------------------------------------------------------------------------
// Agent view — shared shapes between the chat UI and /api/agent/turn.
//
// The agent does everything the upload-then-form flow does, in conversation:
// it reads a JD or a prompt, extracts constraints, says what it understood
// and what is missing (the visible reasoning trace), asks only for blocking
// gaps, and when the constraints are complete it generates the same approved
// query bundle the dashboard would.
// ---------------------------------------------------------------------------

export type AgentField = 'job_title' | 'location' | 'seniority' | 'must_have_skills' | 'domain' | 'organizations' | 'selected_platforms' | 'additional_details' | 'years_of_experience';

export interface AgentQuestion {
  id: string;
  /** Which constraint the answer fills. */
  field: AgentField;
  text: string;
  /** Quick-reply options, when a closed set makes sense. */
  options?: string[];
}

export interface AgentAttachment {
  name: string;
  words: number;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
  /** Assistant only: the reasoning steps behind this turn, shown as a collapsible trace. */
  thoughts?: string[];
  /** Assistant only: questions the recruiter should answer next. */
  questions?: AgentQuestion[];
  /** Assistant only: constraints as of this turn. */
  constraints?: MergedConstraints;
  /** Assistant only: true once the scope is confirmed and queries exist. */
  ready?: boolean;
  /** Assistant only: conversation phase after this turn. */
  phase?: AgentPhase;
  /** User only: a JD file that was attached with this message. */
  attachment?: AgentAttachment;
}

/**
 * Where the conversation is. Queries are built only in 'ready', which needs
 * every required field, the extended scope covered, AND the recruiter's
 * explicit go-ahead — searches cost credits, so the agent never starts them
 * on a partial brief.
 */
export type AgentPhase = 'gathering' | 'scoping' | 'confirming' | 'ready';

export interface ScopeItem {
  field: AgentField | 'confirmation';
  label: string;
  /** 'done' = present or explicitly declined; 'pending' = still to gather; 'optional' = nice to have. */
  state: 'done' | 'pending' | 'optional';
  value?: string;
}

/** Conversation memory the engine keeps beside the transcript. */
export interface AgentState {
  /** Fields the agent has asked about; a reply to an asked field counts as covered even if the answer was "none". */
  askedFields: AgentField[];
  coveredFields: AgentField[];
  confirmed: boolean;
  phase: AgentPhase;
}

export interface AgentTurnResponse {
  sessionId: string;
  message: AgentMessage;
  constraints: MergedConstraints;
  missing: AgentField[];
  scope: ScopeItem[];
  phase: AgentPhase;
  ready: boolean;
  queries: XRayQuery[];
  /** Full transcript after this turn, as stored on the session. */
  transcript: AgentMessage[];
  state: AgentState;
}

/** What the model must return for one turn. Everything else is derived server-side. */
export interface AgentModelOutput {
  thoughts: string[];
  constraints: Partial<{
    job_title: string;
    role_type: MergedConstraints['role_type'];
    seniority: MergedConstraints['seniority'];
    years_of_experience: { min: number; max: number };
    location: string;
    remote_eligible: boolean;
    must_have_skills: string[];
    nice_to_have_skills: string[];
    domain: string[];
    target_organizations: string[];
    excluded_organizations: string[];
    organization_scope: 'current' | 'any';
    selected_platforms: string[];
    additional_details: string;
  }>;
  questions: AgentQuestion[];
  reply: string;
  /** The model's read of the phase; the engine verifies it and can only move it backwards. */
  phase?: AgentPhase;
  /** True when the recruiter's latest message is a go-ahead to build queries. */
  confirms_build?: boolean;
  ready: boolean;
}
