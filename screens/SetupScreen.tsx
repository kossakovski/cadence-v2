import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
} from 'react-native';

interface SetupScreenProps {
  // We keep this intentionally untyped here to avoid cross-file type imports.
  onComplete: (data: any) => void;
}

const SetupScreen: React.FC<SetupScreenProps> = ({ onComplete }) => {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGenerateDemo = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    // Stage 0 demo: ignore the free-form text for now and create a simple structure.
        const data = {
      projectName: 'Cadence App v1 – PPP Prototype',
      workstreams: [
        {
          name: 'Product & UX (Aria)',
          tasks: [
            {
              name: 'Refine Cadence Review layout and pills',
              owner: 'Aria',
              cadence: 'weekly',
            },
            {
              name: 'Design Setup Wizard Stage 0 → 1 flow',
              owner: 'Aria',
              cadence: 'weekly',
            },
          ],
        },
        {
          name: 'Architecture & Data Model (Nikolai)',
          tasks: [
            {
              name: 'Harden PPP cycle immutability rules',
              owner: 'Nikolai',
              cadence: 'weekly',
            },
            {
              name: 'Define cadence types and date helpers',
              owner: 'Nikolai',
              cadence: 'weekly',
            },
          ],
        },
        {
          name: 'Engineering & Implementation (Maya)',
          tasks: [
            {
              name: 'Refactor App.tsx into screens/hooks',
              owner: 'Maya',
              cadence: 'weekly',
            },
            {
              name: 'Wire SetupScreen into main app state',
              owner: 'Maya',
              cadence: 'weekly',
            },
          ],
        },
        {
          name: 'AI Onboarding & Prompts (Leo)',
          tasks: [
            {
              name: 'Define Stage 0 → 1 → 2 prompt schema',
              owner: 'Leo',
              cadence: 'weekly',
            },
            {
              name: 'Draft JSON spec for cadence parsing',
              owner: 'Leo',
              cadence: 'weekly',
            },
          ],
        },
        {
          name: 'QA & Release (Sofia)',
          tasks: [
            {
              name: 'Regression test PPP cycle transitions',
              owner: 'Sofia',
              cadence: 'weekly',
            },
            {
              name: 'Test Setup Wizard reset and edge cases',
              owner: 'Sofia',
              cadence: 'weekly',
            },
          ],
        },
      ],
    };


    onComplete(data);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Cadence Setup Wizard</Text>
      <Text style={styles.subtitle}>
        Stage 0 · Demo Mode
      </Text>
      <Text style={styles.helpText}>
        Paste a short description of your projects, workstreams and tasks.
        In this Stage 0 demo, the text is just for context; we&apos;ll generate
        a simple starter structure so you can try the Cadence PPP flow.
      </Text>

      <TextInput
        style={styles.textArea}
        placeholder="E.g. We run a weekly leadership cadence with 3 projects..."
        multiline
        value={prompt}
        onChangeText={setPrompt}
      />

      <Pressable
        onPress={handleGenerateDemo}
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>
          {isSubmitting ? 'Generating…' : 'Generate Starter Cadence (demo)'}
        </Text>
      </Pressable>
    </View>
  );
};

export default SetupScreen;

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 12,
  },
  helpText: {
    fontSize: 12,
    color: '#555',
    marginBottom: 12,
  },
  textArea: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#c5cae9',
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
    backgroundColor: '#f8f9ff',
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#c5e1a5',
    borderWidth: 1,
    borderColor: '#9ccc65',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#33691e',
  },
});
