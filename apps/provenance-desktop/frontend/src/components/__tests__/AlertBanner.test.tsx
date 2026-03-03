import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AlertBanner from '../AlertBanner'

describe('AlertBanner', () => {
  it('renders when visible and unclassified count is positive', () => {
    render(<AlertBanner visible unclassifiedCount={2} />)

    expect(
      screen.getByText('This transaction graph has 2 unclassified transactions.'),
    ).toBeInTheDocument()
  })

  it('does not render when hidden or count is zero', () => {
    const { container: hiddenContainer } = render(
      <AlertBanner visible={false} unclassifiedCount={3} />,
    )
    expect(hiddenContainer).toBeEmptyDOMElement()

    const { container: emptyContainer } = render(
      <AlertBanner visible unclassifiedCount={0} />,
    )
    expect(emptyContainer).toBeEmptyDOMElement()
  })
})
