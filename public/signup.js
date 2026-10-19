const signupForm = document.getElementById('signup-form');

fetch('/v1/auth/session')
  .then((response) => response.json())
  .then((data) => {
    if (data.user) location.replace('/');
  })
  .catch(() => {});

signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('submit');
  const error = document.getElementById('error');
  button.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(signupForm))),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Unable to create account.');
    location.assign('/');
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    button.disabled = false;
  }
});