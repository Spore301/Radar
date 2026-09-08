import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const { unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();
    const { candidate, jobTitle, companyName, tone, channel } = body;

    const candName = candidate?.name || 'Candidate';
    const skillsList = (candidate?.skills_detected || ['key technologies']).slice(0, 3).join(', ');
    const company = companyName || 'our engineering team';
    const role = jobTitle || 'this key role';

    let subjectLine: string | null = null;
    let messageBody = '';

    if (channel === 'Email') {
      subjectLine = `${role} Opportunity @ ${company} - ${candName}`;
    }

    if (tone === 'Warm') {
      messageBody = `Hi ${candName},

I came across your profile and was really impressed by your achievements in ${skillsList}. We are scaling our product team at ${company} and are looking for a ${role} who takes pride in building exceptional user experiences.

Given your background, I think your skills align really well with what we're building. Would you be open to a casual 15-minute chat to discuss the vision and role details?

Best regards,
Talent Acquisition @ ${company}`;
    } else if (tone === 'Direct') {
      messageBody = `Hi ${candName},

I noticed your expertise with ${skillsList} in your profile. We are currently hiring a ${role} at ${company} to lead critical feature releases.

If you are open to exploring new technical opportunities, let's connect for a brief 10-minute discovery call this week. Let me know what day works best for you!

Best,
Recruitment Lead @ ${company}`;
    } else if (tone === 'Short & Punchy') {
      messageBody = `Hey ${candName}! Loved your work with ${skillsList}. We're looking for a ${role} at ${company} and your profile stood out. Open to a quick 10-min chat Thursday or Friday?`;
    } else {
      messageBody = `Dear ${candName},

I am reaching out regarding a ${role} opportunity with ${company}. Your background with ${skillsList} aligns closely with the core requirements of our open position.

If you are interested in discussing this opportunity, please let me know your availability for a brief preliminary discussion.

Sincerely,
Executive Sourcing Team`;
    }

    const wordCount = messageBody.split(/\s+/).filter(Boolean).length;

    return NextResponse.json({
      success: true,
      subject_line: subjectLine,
      message_body: messageBody,
      word_count: wordCount,
    });
  } catch (error: any) {
    console.error('Error generating outreach message:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate outreach message' },
      { status: 500 }
    );
  }
}
