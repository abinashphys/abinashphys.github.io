---
title: "From the CMB to the first particles: cosmological initial conditions"
course: "PHYS 7127: Cosmology & Galaxies"
institution: Georgia Institute of Technology
instructor: John Wise
period: Fall 2025
order: 1
parts:
  - label: Part A · CMB and matter power spectra
    text: >-
      Used the Boltzmann solver CAMB with the Planck 2018 cosmological parameters to compute the CMB temperature
      and linear matter power spectra, located the first acoustic peak (ℓ ≈ 220) and compared its scale with the
      sound horizon at last scattering, and explored how the spectra respond to the baryon fraction, spatial
      curvature (ΩΛ = 0), a low dark-matter density, early reionization (z = 30) and massive neutrinos.
    shows: >-
      The temperature spectra show a higher baryon density raising the first peak, the open model pushing the
      peaks to higher multipoles, a low dark-matter density strengthening the peaks, and early reionization
      damping the whole spectrum. The matter power spectra show the turnover moving and small-scale power
      changing with the same parameters.
  - label: Part B · Zel'dovich initial conditions
    text: >-
      Wrote Python code that turns the CAMB matter power spectrum into initial conditions for a cosmological
      simulation at z = 99 in a (20 comoving Mpc)³ volume on a 64³ grid: a Gaussian random density field built
      with fast Fourier transforms, and dark-matter particle displacements and velocities from the Zel'dovich
      approximation, for Planck 2018 and an open universe without dark energy.
    shows: >-
      Slices through the density and velocity fields for both cosmologies, the power spectrum measured on the
      grid set against the CAMB input, and a slice of particle positions after the Zel'dovich displacement.
---

A two-part computational term project: from the cosmic microwave background and the matter power spectrum to the
initial conditions of a cosmological simulation.
