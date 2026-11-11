/**
 * The public web configuration of the PaperLab Firebase project. It identifies the project to Google's
 * sign-in; it is not a secret and belongs in the bundle. Access is enforced by the lab's PDF worker.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyDydGhJQet_2ng5QC3xKOpBUtRNOFvItXY',
  authDomain: 'hyperdatalab-paragraph-lab.firebaseapp.com',
  projectId: 'hyperdatalab-paragraph-lab',
  storageBucket: 'hyperdatalab-paragraph-lab.firebasestorage.app',
  messagingSenderId: '537098100241',
  appId: '1:537098100241:web:f15034bcfa3c19bffb1bb0',
};
export const LAB_DOMAIN = 'hyperdatalab.org';

/** The same rule the worker applies: exactly one '@' and exactly the lab's domain. */
export function labEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const at = email.indexOf('@');
  return at > 0 && at === email.lastIndexOf('@') && email.slice(at + 1).toLowerCase() === LAB_DOMAIN;
}
