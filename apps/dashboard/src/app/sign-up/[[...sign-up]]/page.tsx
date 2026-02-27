import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7] dark:bg-[#141414]">
      <SignUp afterSignUpUrl="/onboarding" />
    </div>
  );
}
