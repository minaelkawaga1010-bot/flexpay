import { NextRequest, NextResponse } from 'next/server';

const SYSTEM_PROMPT = `You are FlexPay AI, a friendly digital wallet assistant for migrant workers in the UAE. You help users:
- Check wallet balances (AED, INR, PHP, PKR)
- Send money (P2P transfers and international remittances)
- View transaction history
- Check credit score
- Manage Hafiza savings circles
- Check loyalty points and rewards

Keep responses short (2-3 sentences max), friendly, and actionable.
Use simple language. If the user asks about something you can't help with, politely redirect.
Current user: Rajesh Kumar, Phone: +971501234567, KYC Level 2, Role: EMPLOYEE.
The user's wallet has approximately AED 12,500 total balance across multiple currencies.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { audioBase64, language } = body as {
      audioBase64: string;
      language?: string;
    };

    if (!audioBase64) {
      return NextResponse.json(
        { error: 'audioBase64 is required' },
        { status: 400 }
      );
    }

    // Step 1: Dynamic import of z-ai-web-dev-sdk (server-side only)
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    // Step 2: ASR — Transcribe audio
    let transcription: string | null = null;
    try {
      const asrResponse = await zai.audio.asr.create({
        file_base64: audioBase64,
        ...(language ? { language } : {}),
      });
      transcription = asrResponse.text;
    } catch (asrError) {
      console.error('ASR transcription failed:', asrError);
      return NextResponse.json(
        {
          transcription: null,
          response:
            "I'm sorry, I couldn't understand your voice input. Could you please try again or type your message?",
          error: 'Transcription failed',
        },
        { status: 200 }
      );
    }

    // Step 3: LLM — Generate contextual response
    let response: string;
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: SYSTEM_PROMPT },
          { role: 'user', content: transcription ?? '' },
        ],
        thinking: { type: 'disabled' },
      });
      response =
        completion.choices[0]?.message?.content ??
        "I'm sorry, I couldn't generate a response. Please try again.";
    } catch (llmError) {
      console.error('LLM response generation failed:', llmError);
      response =
        "I'm having trouble processing your request right now. Please try again in a moment. You can also use the menu to check your balance, send money, or view transactions.";
    }

    // Step 4: TTS — Generate audio response
    let audioBase64Response: string | undefined;
    try {
      const ttsResponse = await zai.audio.tts.create({
        input: response.substring(0, 1024), // max 1024 characters
        voice: 'tongtong',
        speed: 1.0,
        response_format: 'wav',
        stream: false,
      });
      const arrayBuffer = await ttsResponse.arrayBuffer();
      const audioBuffer = Buffer.from(new Uint8Array(arrayBuffer));
      audioBase64Response = audioBuffer.toString('base64');
    } catch (ttsError) {
      console.error('TTS audio generation failed:', ttsError);
      // Return response without audio — client handles gracefully
      return NextResponse.json({ transcription, response });
    }

    // Step 5: Return full result
    return NextResponse.json({
      transcription,
      response,
      audioBase64: audioBase64Response,
    });
  } catch (error) {
    console.error('Voice process endpoint error:', error);
    return NextResponse.json(
      {
        transcription: null,
        response: 'Something went wrong. Please try again.',
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
