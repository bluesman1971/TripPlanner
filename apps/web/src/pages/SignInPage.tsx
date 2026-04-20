import { SignIn } from '@clerk/react';

export function SignInPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Trip Planner</h1>
          <p className="mt-1 text-gray-500 text-sm">Consultant portal</p>
        </div>
        <SignIn routing="path" path="/sign-in" signUpUrl={undefined} />
      </div>
    </div>
  );
}
