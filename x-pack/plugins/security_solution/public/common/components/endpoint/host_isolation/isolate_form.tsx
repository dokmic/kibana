/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { ChangeEventHandler, memo, ReactNode, useCallback } from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiText,
  EuiTextArea,
  EuiTitle,
} from '@elastic/eui';
import { FormattedMessage } from '@kbn/i18n/react';
import { CANCEL, COMMENT, COMMENT_PLACEHOLDER, CONFIRM } from './translations';

export interface EndpointIsolatedFormProps {
  hostName: string;
  onCancel: () => void;
  onConfirm: () => void;
  onChange: (changes: { comment: string }) => void;
  comment?: string;
  /** Any additional message to be appended to the default one */
  messageAppend?: ReactNode;
  /** If true, then `Confirm` and `Cancel` buttons will be disabled, and `Confirm` button will loading loading style */
  isLoading?: boolean;
}

export const EndpointIsolateForm = memo<EndpointIsolatedFormProps>(
  ({ hostName, onCancel, onConfirm, onChange, comment = '', messageAppend, isLoading = false }) => {
    const handleCommentChange: ChangeEventHandler<HTMLTextAreaElement> = useCallback(
      (event) => {
        onChange({ comment: event.target.value });
      },
      [onChange]
    );

    return (
      <>
        <EuiText size="s">
          <p>
            <FormattedMessage
              id="xpack.securitySolution.endpoint.hostIsolation.isolateThisHost"
              defaultMessage="Isolate host {hostName} from network."
              values={{ hostName: <b>{hostName}</b> }}
            />{' '}
            {messageAppend}
          </p>
        </EuiText>

        <EuiSpacer size="m" />

        <EuiTitle size="xs">
          <h4>{COMMENT}</h4>
        </EuiTitle>
        <EuiTextArea
          data-test-subj="host_isolation_comment"
          fullWidth
          placeholder={COMMENT_PLACEHOLDER}
          value={comment}
          onChange={handleCommentChange}
        />

        <EuiSpacer size="m" />

        <EuiFlexGroup justifyContent="flexEnd">
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty onClick={onCancel} disabled={isLoading}>
              {CANCEL}
            </EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton fill onClick={onConfirm} disabled={isLoading} isLoading={isLoading}>
              {CONFIRM}
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      </>
    );
  }
);

EndpointIsolateForm.displayName = 'EndpointIsolateForm';
