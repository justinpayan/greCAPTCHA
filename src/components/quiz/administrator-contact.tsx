"use client";

export function AdministratorContact({ email }: { email?: string | null }) {
  return <section className="card form-card">
    <h2>Contact the test administrator</h2>
    {email ? <p>
      For questions about your results or requests to delete your submission, email {" "}
      <a href={`mailto:${email}`}>{email}</a>.
    </p> : <p>The test administrator has not verified a contact email yet. Contact the person who shared this test with you for questions or submission deletion requests.</p>}
  </section>;
}
