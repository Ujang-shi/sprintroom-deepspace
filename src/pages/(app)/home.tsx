/** Signed-in landing inside the app chrome; the product itself lives at /workspace. */

import { Link } from 'react-router-dom'
import { useAuthProfileReady } from 'deepspace'
import { APP_NAME } from '../../constants'

export default function HomePage() {
  const { isSignedIn, user } = useAuthProfileReady({ requireUser: true })

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground">
      <h1 className="text-2xl font-semibold">{APP_NAME}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Plan sprints with your team in real time.
      </p>
      {isSignedIn && user && (
        <p className="text-sm text-muted-foreground">Signed in as {user.name ?? user.email}</p>
      )}
      <Link to="/workspace" className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">
        Open workspace
      </Link>
    </div>
  )
}
